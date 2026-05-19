import { hmacSign, hmacVerify } from '../../lib/crypto';
import type { ChannelAdapter, IngressMessage } from '../../types/channels';
import { parseChannelConfigAsync } from '../utils';

// Apple Messages for Business (the brand previously called Apple Business
// Chat). Once a business is approved in Apple Business Register, Apple's
// gateway POSTs inbound messages signed with `Authorization: ApplePay
// keyId=…, signature=…` and a JWS-style separator. For deployments that
// don't run a full JWS validator we accept the operator-set `webhook_secret`
// echoed as `X-Apple-Webhook-Secret` — Apple proxies the request through
// the operator's MSP, which can pin that header in their config. A future
// enhancement can replace this with full JWS verification using the
// public-key bundle Apple publishes.
//
// Outbound: POST https://mspgw.push.apple.com/v1/message with a JWT-signed
// bearer header. We let the operator paste a pre-minted bearer that they
// rotate out-of-band; sign-on-demand JWTs are a future enhancement.

interface AppleBusinessConfig {
  business_id: string;
  msp_id: string;
  source_id: string;
  webhook_secret: string;
  bearer_token: string;
  [k: string]: unknown;
}

const APPLE_MSP_GATEWAY = 'https://mspgw.push.apple.com/v1/message';

export const appleBusinessAdapter: ChannelAdapter = {
  kind: 'apple_business',
  capabilities: {
    supportsInbound: true,
    supportsOutbound: true,
    supportsAttachments: true,
    supportsRichText: true,
    supportsButtons: true,
    supportsOtpDelivery: false,
    supportsPresence: true,
    supportsVoice: false,
    supportsStreaming: false,
    maxMessageLength: 10_000,
    maxAttachmentBytes: 100 * 1024 * 1024,
  },
  secretFields: ['webhook_secret', 'bearer_token'],

  validateConfig(input) {
    const cfg = input as Partial<AppleBusinessConfig>;
    if (!cfg.business_id) throw new Error('config_invalid:business_id_required');
    if (!cfg.msp_id) throw new Error('config_invalid:msp_id_required');
    if (!cfg.source_id) throw new Error('config_invalid:source_id_required');
    if (!cfg.webhook_secret || cfg.webhook_secret.length < 16) {
      throw new Error('config_invalid:webhook_secret_required');
    }
    if (!cfg.bearer_token || cfg.bearer_token.length < 16) {
      throw new Error('config_invalid:bearer_token_required');
    }
    return {
      business_id: cfg.business_id,
      msp_id: cfg.msp_id,
      source_id: cfg.source_id,
      webhook_secret: cfg.webhook_secret,
      bearer_token: cfg.bearer_token,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    const cfg = await parseChannelConfigAsync<AppleBusinessConfig>(env, channel);
    const provided = headers['x-apple-webhook-secret'] ?? headers['x-ranse-apple-secret'];
    if (!provided) return { ok: false, reason: 'missing_apple_secret_header' };
    // The header can be either the raw secret (when set by the MSP) or an
    // HMAC of the body (when set by Ranse-compatible proxies). Accept both
    // to make integration robust against the wide variety of MSP setups.
    if (provided === cfg.webhook_secret) return { ok: true };
    const expected = await hmacSign(cfg.webhook_secret, rawBody);
    return hmacVerify(expected, provided)
      ? { ok: true }
      : { ok: false, reason: 'apple_secret_mismatch' };
  },

  async parseIngress(_env, _channel, _headers, rawBody) {
    const event = JSON.parse(rawBody) as AppleBusinessEvent;
    const body = event.body ?? event.message;
    if (!body || event.type !== 'text') return null;
    const text = body.body ?? body.text;
    if (!text) return null;
    const opaqueUserId = event.sourceId ?? event.id ?? '';
    if (!opaqueUserId) return null;
    return {
      externalId: event.id ?? `apple_business:${Date.now()}`,
      externalThreadId: opaqueUserId,
      text,
      from: {
        externalId: opaqueUserId,
        displayName: null,
      },
      subject: event.intent ?? null,
      receivedAt: event.locale ? Date.now() : Date.now(),
    } satisfies IngressMessage;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<AppleBusinessConfig>(env, channel);
    const opaqueUserId = message.externalThreadId;
    if (!opaqueUserId) throw new Error('apple_business_no_recipient_for_egress');
    const res = await fetch(APPLE_MSP_GATEWAY, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.bearer_token}`,
        'content-type': 'application/json',
        'source-id': cfg.source_id,
        'destination-id': opaqueUserId,
        id: message.messageId,
      },
      body: JSON.stringify({
        v: '1',
        type: 'text',
        sourceId: cfg.source_id,
        destinationId: opaqueUserId,
        body: message.text.slice(0, 10_000),
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`apple_business_send_failed:${res.status}:${errBody.slice(0, 200)}`);
    }
    return { externalId: message.messageId, externalThreadId: opaqueUserId };
  },
};

interface AppleBusinessEvent {
  type?: 'text' | string;
  id?: string;
  sourceId?: string;
  destinationId?: string;
  intent?: string;
  locale?: string;
  body?: { body?: string; text?: string };
  message?: { body?: string; text?: string };
}
