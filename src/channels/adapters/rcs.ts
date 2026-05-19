import { hmacSign, hmacVerify } from '../../lib/crypto';
import type { ChannelAdapter, IngressMessage } from '../../types/channels';
import { parseChannelConfigAsync } from '../utils';

// Google Business Messages (the operator-facing RCS Business Messaging
// surface). Partners register a brand + agent through the Business
// Communications API; webhooks land at /public/channels/<key>/webhook with
// the operator-set `client_token` echoed in the body and signed via HMAC
// using `partner_secret`.
//
// Outbound: POST /v1/conversations/{conversationId}/messages with a bearer
// service-account token. To keep this dependency-free we let the operator
// paste a pre-minted bearer token they refresh out-of-band; a future
// enhancement can sign JWTs server-side.

interface RcsConfig {
  agent_id: string;
  partner_secret: string; // signs inbound webhook bodies
  oauth_token: string; // bearer for outbound /messages calls
  webhook_url: string;
  [k: string]: unknown;
}

const BUSINESS_MESSAGES_API = 'https://businessmessages.googleapis.com';

export const rcsAdapter: ChannelAdapter = {
  kind: 'rcs',
  capabilities: {
    supportsInbound: true,
    supportsOutbound: true,
    supportsAttachments: true,
    supportsRichText: true,
    supportsButtons: true,
    supportsOtpDelivery: true,
    supportsPresence: true,
    supportsVoice: false,
    supportsStreaming: false,
    maxMessageLength: 8_000,
    maxAttachmentBytes: 100 * 1024 * 1024,
  },
  secretFields: ['partner_secret', 'oauth_token'],

  validateConfig(input) {
    const cfg = input as Partial<RcsConfig>;
    if (!cfg.agent_id) throw new Error('config_invalid:agent_id_required');
    if (!cfg.partner_secret || cfg.partner_secret.length < 16) {
      throw new Error('config_invalid:partner_secret_required');
    }
    if (!cfg.oauth_token || cfg.oauth_token.length < 16) {
      throw new Error('config_invalid:oauth_token_required');
    }
    if (!cfg.webhook_url || !/^https:\/\//.test(cfg.webhook_url)) {
      throw new Error('config_invalid:webhook_url_required_https');
    }
    return {
      agent_id: cfg.agent_id,
      partner_secret: cfg.partner_secret,
      oauth_token: cfg.oauth_token,
      webhook_url: cfg.webhook_url,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<RcsConfig>(env, channel);
    const sig = headers['x-goog-signature'];
    if (!sig) return { ok: false, reason: 'missing_goog_signature' };
    const expected = await hmacSign(cfg.partner_secret, rawBody);
    return hmacVerify(expected, sig) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    const event = JSON.parse(rawBody) as RcsEvent;
    if (!event.message?.text) return null;
    return {
      externalId: event.message.messageId ?? `rcs:${Date.now()}`,
      externalThreadId: event.conversationId,
      text: event.message.text,
      from: {
        externalId: event.context?.userInfo?.userDeviceLocale
          ? `rcs:${event.conversationId}`
          : event.conversationId,
        displayName: event.context?.userInfo?.displayName ?? null,
      },
      subject: null,
      receivedAt: event.sendTime ? Date.parse(event.sendTime) : Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<RcsConfig>(env, channel);
    const conversationId = message.externalThreadId;
    if (!conversationId) throw new Error('rcs_no_conversation_for_egress');
    const url = `${BUSINESS_MESSAGES_API}/v1/conversations/${encodeURIComponent(conversationId)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.oauth_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messageId: message.messageId,
        representative: { representativeType: 'BOT' },
        text: message.text.slice(0, 8_000),
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`rcs_send_failed:${res.status}:${errBody.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { name?: string };
    return {
      externalId: data.name ?? message.messageId,
      externalThreadId: conversationId,
    };
  },
};

interface RcsEvent {
  conversationId: string;
  message?: { messageId?: string; text?: string };
  sendTime?: string;
  context?: { userInfo?: { displayName?: string; userDeviceLocale?: string } };
}
