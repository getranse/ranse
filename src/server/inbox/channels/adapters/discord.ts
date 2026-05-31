import type { DiscordConfig, DiscordPayload } from '../../../../interfaces/channels';
import type { IngressMessage } from '../../../../types/shared/channels';
import type { ChannelAdapter } from '../../../../types/server/channels';
import { DISCORD_CAPS } from '../capabilities';
import { parseChannelConfigAsync } from '../utils';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export const discordAdapter: ChannelAdapter = {
  kind: 'discord',
  capabilities: DISCORD_CAPS,
  secretFields: ['bot_token'],

  validateConfig(input) {
    const cfg = input as Partial<DiscordConfig>;
    if (!cfg.application_id || !/^\d{15,}$/.test(cfg.application_id)) {
      throw new Error('config_invalid:application_id_required');
    }
    if (!cfg.public_key || !/^[0-9a-f]{64}$/i.test(cfg.public_key)) {
      throw new Error('config_invalid:public_key_required');
    }
    if (!cfg.bot_token || cfg.bot_token.length < 32) {
      throw new Error('config_invalid:bot_token_required');
    }
    return {
      application_id: cfg.application_id,
      public_key: cfg.public_key.toLowerCase(),
      bot_token: cfg.bot_token,
      guild_id: cfg.guild_id ?? null,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<DiscordConfig>(env, channel);
    const signature = headers['x-signature-ed25519'];
    const timestamp = headers['x-signature-timestamp'];
    if (!signature || !timestamp) return { ok: false, reason: 'missing_discord_headers' };
    try {
      const ok = await verifyEd25519(
        hexToBytes(cfg.public_key),
        hexToBytes(signature),
        new TextEncoder().encode(timestamp + rawBody),
      );
      return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
    } catch {
      return { ok: false, reason: 'signature_verify_failed' };
    }
  },

  async handleChallenge(_env, _channel, request) {
    // Discord sends Interactions PING (type 1) on URL save. Respond PONG.
    const body = await request
      .clone()
      .json()
      .catch(() => null);
    if (body && (body as any).type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return null;
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    const event = JSON.parse(rawBody) as DiscordPayload;
    // Application Command (slash) or Message Component
    if (event.type !== 2 && event.type !== 5) return null;
    const userId = event.member?.user?.id ?? event.user?.id ?? `discord:${Date.now().toString(36)}`;
    const channelId = event.channel_id ?? '';
    const text = readSlashText(event) ?? '';
    if (!text.trim()) return null;
    return {
      externalId: event.id ?? `discord:${Date.now()}`,
      externalThreadId: channelId,
      text,
      from: {
        externalId: userId,
        displayName:
          event.member?.user?.global_name ??
          event.member?.user?.username ??
          event.user?.global_name ??
          event.user?.username ??
          null,
      },
      subject: null,
      receivedAt: Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<DiscordConfig>(env, channel);
    const channelId = message.externalThreadId;
    if (!channelId) throw new Error('discord_no_channel_for_egress');
    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${cfg.bot_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: message.text.slice(0, DISCORD_CAPS.maxMessageLength),
      }),
    });
    if (!res.ok) {
      throw new Error(`discord_send_failed:${res.status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { externalId: data.id ?? null, externalThreadId: channelId };
  },
};

function readSlashText(event: DiscordPayload): string | null {
  const opts = event.data?.options ?? [];
  const messageOpt = opts.find((o) => o.name === 'message' || o.name === 'text');
  if (messageOpt && typeof messageOpt.value === 'string') return messageOpt.value;
  return null;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifyEd25519(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', toAb(publicKey), { name: 'Ed25519' }, false, [
    'verify',
  ]);
  return crypto.subtle.verify('Ed25519', key, toAb(signature), toAb(message));
}

function toAb(view: Uint8Array): ArrayBuffer {
  // crypto.subtle types require strict ArrayBuffer (not SharedArrayBuffer);
  // copy into a fresh buffer so the call type-checks across runtimes.
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}
