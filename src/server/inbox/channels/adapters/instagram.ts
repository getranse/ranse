import type { InstagramConfig, InstagramWebhook } from '../../../../interfaces/channels';
import type { IngressMessage } from '../../../../types/shared/channels';
import type { ChannelAdapter } from '../../../../types/server/channels';
import { parseChannelConfigAsync } from '../utils';
import {
  handleMetaChallenge,
  validateMetaConfig,
  verifyMetaWebhook,
} from './meta-shared';

const META_GRAPH = 'https://graph.facebook.com';

export const instagramAdapter: ChannelAdapter = {
  kind: 'instagram',
  capabilities: {
    supportsInbound: true,
    supportsOutbound: true,
    supportsAttachments: true,
    supportsRichText: false,
    supportsButtons: true,
    supportsOtpDelivery: false,
    supportsPresence: true,
    supportsVoice: false,
    supportsStreaming: false,
    maxMessageLength: 1_000,
    maxAttachmentBytes: 25 * 1024 * 1024,
  },
  secretFields: ['app_secret', 'access_token', 'verify_token'],

  validateConfig(input) {
    const cfg = input as Partial<InstagramConfig>;
    if (!cfg.ig_id || !/^\d{6,}$/.test(cfg.ig_id)) {
      throw new Error('config_invalid:ig_id_required');
    }
    return {
      ...validateMetaConfig(input as Record<string, unknown>),
      ig_id: cfg.ig_id,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    return verifyMetaWebhook(env, channel, headers, rawBody);
  },

  async handleChallenge(env, channel, request) {
    return handleMetaChallenge(env, channel, request);
  },

  async parseIngress(env, channel, _headers, rawBody) {
    const cfg = await parseChannelConfigAsync<InstagramConfig>(env, channel);
    const payload = JSON.parse(rawBody) as InstagramWebhook;
    if (payload.object !== 'instagram') return null;
    for (const entry of payload.entry ?? []) {
      if (entry.id !== cfg.ig_id) continue;
      for (const event of entry.messaging ?? []) {
        if (!event.message || event.message.is_echo) continue;
        const text = event.message.text;
        if (!text) continue;
        return {
          externalId: event.message.mid ?? `instagram:${Date.now()}`,
          externalThreadId: event.sender?.id ?? '',
          text,
          from: {
            externalId: event.sender?.id ?? '',
            displayName: null,
          },
          subject: null,
          receivedAt: event.timestamp ?? Date.now(),
        } satisfies IngressMessage;
      }
    }
    return null;
  },

  async egress(env, channel, message) {
    const cfg = await parseChannelConfigAsync<InstagramConfig>(env, channel);
    const recipientId = message.externalThreadId;
    if (!recipientId) throw new Error('instagram_no_recipient_for_egress');
    const url = `${META_GRAPH}/${cfg.graph_version}/${cfg.ig_id}/messages?access_token=${encodeURIComponent(cfg.access_token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message.text.slice(0, 1_000) },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      error?: { message?: string };
    };
    if (!res.ok || !data.message_id) {
      throw new Error(`instagram_send_failed:${data.error?.message ?? res.status}`);
    }
    return { externalId: data.message_id, externalThreadId: recipientId };
  },
};
