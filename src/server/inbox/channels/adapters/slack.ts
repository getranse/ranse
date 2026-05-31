import type { SlackConfig, SlackEnvelope, } from '../../../../interfaces/channels';
import { hmacSign, hmacVerify } from '../../../../lib/crypto';
import type { IngressMessage } from '../../../../types/shared/channels';
import type { ChannelAdapter } from '../../../../types/server/channels';
import { SLACK_CAPS } from '../capabilities';
import { parseChannelConfigAsync } from '../utils';

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const SLACK_API_BASE = 'https://slack.com/api';

export const slackAdapter: ChannelAdapter = {
  kind: 'slack',
  capabilities: SLACK_CAPS,
  secretFields: ['bot_token', 'signing_secret'],

  validateConfig(input) {
    const cfg = input as Partial<SlackConfig>;
    if (!cfg.bot_token?.startsWith('xoxb-')) {
      throw new Error('config_invalid:bot_token_required');
    }
    if (!cfg.signing_secret || cfg.signing_secret.length < 16) {
      throw new Error('config_invalid:signing_secret_required');
    }
    return {
      bot_token: cfg.bot_token,
      signing_secret: cfg.signing_secret,
      bot_user_id: cfg.bot_user_id ?? null,
      app_id: cfg.app_id ?? null,
      team_id: cfg.team_id ?? null,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<SlackConfig>(env, channel);
    const timestamp = headers['x-slack-request-timestamp'];
    const signature = headers['x-slack-signature'];
    if (!timestamp || !signature) return { ok: false, reason: 'missing_slack_headers' };
    const tsNum = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(tsNum)) return { ok: false, reason: 'invalid_timestamp' };
    const drift = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
    if (drift > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp_out_of_range' };
    const baseString = `v0:${timestamp}:${rawBody}`;
    const expected = `v0=${await hmacSign(cfg.signing_secret, baseString)}`;
    return hmacVerify(expected, signature)
      ? { ok: true }
      : { ok: false, reason: 'signature_mismatch' };
  },

  async handleChallenge(_env, _channel, request) {
    const body = await request
      .clone()
      .json()
      .catch(() => null);
    if (body && typeof body === 'object' && (body as any).type === 'url_verification') {
      return new Response((body as any).challenge ?? '', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return null;
  },

  async parseIngress(env, channel, _headers, rawBody) {
    const cfg = await parseChannelConfigAsync<SlackConfig>(env, channel);
    const event = JSON.parse(rawBody) as SlackEnvelope;
    if (event.type !== 'event_callback' || !event.event) return null;
    const inner = event.event;
    if (inner.type !== 'app_mention' && inner.type !== 'message') return null;
    if (inner.bot_id || inner.subtype === 'bot_message') return null;
    if (cfg.bot_user_id && inner.user === cfg.bot_user_id) return null;

    const text = stripBotMention(inner.text ?? '', cfg.bot_user_id);
    if (!text) return null;
    const threadKey = inner.thread_ts ?? inner.ts;
    const channelId = inner.channel ?? '';
    const externalThreadId = `${channelId}:${threadKey}`;
    return {
      externalId: inner.ts ?? `${channelId}:${Date.now()}`,
      externalThreadId,
      text,
      from: {
        externalId: `${event.team_id ?? cfg.team_id ?? 'team'}:${inner.user ?? 'unknown'}`,
        displayName: inner.user ? `slack:${inner.user}` : null,
      },
      subject: null,
      receivedAt: inner.event_ts
        ? Math.floor(Number.parseFloat(inner.event_ts) * 1000)
        : Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<SlackConfig>(env, channel);
    const [channelId, threadTs] = (message.externalThreadId ?? '').split(':');
    if (!channelId) throw new Error('slack_no_channel_for_egress');
    const payload: Record<string, unknown> = {
      channel: channelId,
      text: message.text.slice(0, SLACK_CAPS.maxMessageLength),
    };
    if (threadTs) payload.thread_ts = threadTs;
    const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.bot_token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      ts?: string;
      error?: string;
    };
    if (!body.ok) throw new Error(`slack_post_failed:${body.error ?? res.status}`);
    return {
      externalId: body.ts ?? null,
      externalThreadId: threadTs ? `${channelId}:${threadTs}` : `${channelId}:${body.ts ?? ''}`,
    };
  },
};

function stripBotMention(text: string, botUserId?: string | null): string {
  if (!botUserId) return text.trim();
  const mention = new RegExp(`<@${botUserId}>`, 'g');
  return text.replace(mention, '').trim();
}

// Also exported for the URL the operator pastes into Slack's "Event
// Subscriptions" → "Request URL" + "Subscribe to bot events". Kept here
// so adding a new provider can colocate its UI hint with the adapter.
export const SLACK_BOT_EVENTS = ['app_mention', 'message.im'] as const;
