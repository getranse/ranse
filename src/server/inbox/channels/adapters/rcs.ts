import type { RcsConfig, RcsEvent } from '../../../../interfaces/channels';
import { hmacSign, hmacVerify } from '../../../../lib/crypto';
import type { IngressMessage } from '../../../../types/shared/channels';
import type { ChannelAdapter } from '../../../../types/server/channels';
import { parseChannelConfigAsync } from '../utils';

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
