import type { WhatsappConfig, WhatsappWebhook, WhatsappMessage } from '../../../../interfaces/channels';
import { hmacSign, hmacVerify } from '../../../../lib/crypto';
import type { IngressMessage } from '../../../../types/shared/channels';
import type { ChannelAdapter } from '../../../../types/server/channels';
import { WHATSAPP_CAPS } from '../capabilities';
import { parseChannelConfigAsync } from '../utils';

const META_GRAPH = 'https://graph.facebook.com';

export const whatsappAdapter: ChannelAdapter = {
  kind: 'whatsapp',
  capabilities: WHATSAPP_CAPS,
  secretFields: ['app_secret', 'access_token', 'verify_token'],

  validateConfig(input) {
    const cfg = input as Partial<WhatsappConfig>;
    if (!cfg.phone_number_id || !/^\d{6,}$/.test(cfg.phone_number_id)) {
      throw new Error('config_invalid:phone_number_id_required');
    }
    if (!cfg.app_secret || cfg.app_secret.length < 16) {
      throw new Error('config_invalid:app_secret_required');
    }
    if (!cfg.access_token || cfg.access_token.length < 16) {
      throw new Error('config_invalid:access_token_required');
    }
    if (!cfg.verify_token || cfg.verify_token.length < 8) {
      throw new Error('config_invalid:verify_token_required');
    }
    return {
      phone_number_id: cfg.phone_number_id,
      app_secret: cfg.app_secret,
      access_token: cfg.access_token,
      verify_token: cfg.verify_token,
      graph_version: cfg.graph_version ?? 'v20.0',
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<WhatsappConfig>(env, channel);
    const signature = headers['x-hub-signature-256'];
    if (!signature) return { ok: false, reason: 'missing_x_hub_signature' };
    const expected = `sha256=${await hmacSign(cfg.app_secret, rawBody)}`;
    return hmacVerify(expected, signature)
      ? { ok: true }
      : { ok: false, reason: 'signature_mismatch' };
  },

  async handleChallenge(env, channel, request) {
    // Meta verifies webhook subscriptions with a GET ?hub.mode=subscribe&...
    const url = new URL(request.url);
    if (request.method !== 'GET') return null;
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode !== 'subscribe' || !challenge) return null;
    const cfg = await parseChannelConfigAsync<WhatsappConfig>(env, channel);
    if (token !== cfg.verify_token) return new Response('Forbidden', { status: 403 });
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  },

  async parseIngress(env, channel, _headers, rawBody) {
    const cfg = await parseChannelConfigAsync<WhatsappConfig>(env, channel);
    const payload = JSON.parse(rawBody) as WhatsappWebhook;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value || value.metadata?.phone_number_id !== cfg.phone_number_id) continue;
        const message = value.messages?.[0];
        const contact = value.contacts?.[0];
        if (!message) continue; // status receipts etc — not an inbound message
        const text = readWhatsappText(message);
        if (!text) continue;
        return {
          externalId: message.id ?? `wa:${Date.now()}`,
          externalThreadId: message.from,
          text,
          from: {
            externalId: message.from,
            phone: message.from,
            displayName: contact?.profile?.name ?? null,
          },
          subject: null,
          receivedAt: message.timestamp
            ? Number.parseInt(message.timestamp, 10) * 1000
            : Date.now(),
        } satisfies IngressMessage;
      }
    }
    return null;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<WhatsappConfig>(env, channel);
    const to = message.externalThreadId;
    if (!to) throw new Error('whatsapp_no_destination_for_egress');
    const url = `${META_GRAPH}/${cfg.graph_version}/${cfg.phone_number_id}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: message.text.slice(0, WHATSAPP_CAPS.maxMessageLength),
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!res.ok || !data.messages?.[0]?.id) {
      throw new Error(`whatsapp_send_failed:${data.error?.message ?? res.status}`);
    }
    return { externalId: data.messages[0].id, externalThreadId: to };
  },
};

function readWhatsappText(message: WhatsappMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return null;
}
