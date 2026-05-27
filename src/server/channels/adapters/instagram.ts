import type { ChannelAdapter, IngressMessage } from '../../../types/channels';
import { parseChannelConfigAsync } from '../utils';
import {
  handleMetaChallenge,
  type MetaSharedConfig,
  validateMetaConfig,
  verifyMetaWebhook,
} from './meta-shared';

// Instagram DM via Meta Graph (Instagram Messaging API). The webhook shape
// mirrors Messenger; the differences:
//   - the `object` field in the envelope is 'instagram'
//   - the IDs in `sender.id` are Instagram-Scoped IDs, not Page-Scoped IDs
//   - outbound goes to the IG-connected Facebook Page, identified by
//     ig_id resolved at config time
//
// The operator links an Instagram Business Account to a Facebook Page and
// gives us the IG Business Account id; we use that as `ig_id`.

interface InstagramConfig extends MetaSharedConfig {
  ig_id: string;
}

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

interface InstagramWebhook {
  object?: string;
  entry?: {
    id: string;
    messaging?: {
      sender?: { id: string };
      recipient?: { id: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }[];
  }[];
}
