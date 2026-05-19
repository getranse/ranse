import type { ChannelAdapter } from '../../types/channels';
import { CHAT_CAPS } from '../capabilities';

// The embedded chat widget is a first-party surface — the customer's browser
// talks to /public/* directly, the operator's reply is read by the same
// browser via the timeline polling endpoint. No external webhooks, no
// egress dispatch needed.

export const chatAdapter: ChannelAdapter = {
  kind: 'chat',
  capabilities: CHAT_CAPS,
  validateConfig: () => ({}),
  verifyWebhook: async () => ({ ok: false, reason: 'chat_has_no_external_webhook' }),
  parseIngress: async () => null,
  egress: async () => ({ externalId: null, externalThreadId: null }),
};
