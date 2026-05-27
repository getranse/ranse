import type { ChannelAdapter, IngressMessage } from '../../../types/channels';
import { parseChannelConfigAsync } from '../utils';
import {
  handleMetaChallenge,
  type MetaSharedConfig,
  validateMetaConfig,
  verifyMetaWebhook,
} from './meta-shared';

// Facebook Messenger Platform via Meta Graph. Per-Page access token + the
// app-level secret/verify_token. Outbound: POST /me/messages on the Page.

interface MessengerConfig extends MetaSharedConfig {
  page_id: string;
}

const META_GRAPH = 'https://graph.facebook.com';

export const messengerAdapter: ChannelAdapter = {
  kind: 'messenger',
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
    maxMessageLength: 2_000,
    maxAttachmentBytes: 25 * 1024 * 1024,
  },
  secretFields: ['app_secret', 'access_token', 'verify_token'],

  validateConfig(input) {
    const cfg = input as Partial<MessengerConfig>;
    if (!cfg.page_id || !/^\d{6,}$/.test(cfg.page_id)) {
      throw new Error('config_invalid:page_id_required');
    }
    return {
      ...validateMetaConfig(input as Record<string, unknown>),
      page_id: cfg.page_id,
    };
  },

  async verifyWebhook(env, channel, headers, rawBody) {
    return verifyMetaWebhook(env, channel, headers, rawBody);
  },

  async handleChallenge(env, channel, request) {
    return handleMetaChallenge(env, channel, request);
  },

  async parseIngress(env, channel, _headers, rawBody) {
    const cfg = await parseChannelConfigAsync<MessengerConfig>(env, channel);
    const payload = JSON.parse(rawBody) as MessengerWebhook;
    if (payload.object !== 'page') return null;
    for (const entry of payload.entry ?? []) {
      if (entry.id !== cfg.page_id) continue;
      for (const event of entry.messaging ?? []) {
        if (!event.message || event.message.is_echo) continue;
        const text = event.message.text;
        if (!text) continue;
        return {
          externalId: event.message.mid ?? `messenger:${Date.now()}`,
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
    const cfg = await parseChannelConfigAsync<MessengerConfig>(env, channel);
    const recipientId = message.externalThreadId;
    if (!recipientId) throw new Error('messenger_no_recipient_for_egress');
    const url = `${META_GRAPH}/${cfg.graph_version}/me/messages?access_token=${encodeURIComponent(cfg.access_token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text: message.text.slice(0, 2_000) },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      error?: { message?: string };
    };
    if (!res.ok || !data.message_id) {
      throw new Error(`messenger_send_failed:${data.error?.message ?? res.status}`);
    }
    return { externalId: data.message_id, externalThreadId: recipientId };
  },
};

interface MessengerWebhook {
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
