import type { ChannelAdapter } from '../../../../types/server/channels';
import { FORM_CAPS } from '../capabilities';

// Hosted forms are write-only: a customer submits the form, we create a
// ticket, and replies go out via email (because the form collected one).
// The adapter exists for capability lookup; the outbound dispatcher would
// see supportsOutbound=false and the reply pipeline falls through to email.

export const formAdapter: ChannelAdapter = {
  kind: 'form',
  capabilities: FORM_CAPS,
  validateConfig: () => ({}),
  verifyWebhook: async () => ({ ok: false, reason: 'form_has_no_external_webhook' }),
  parseIngress: async () => null,
  egress: async () => {
    throw new Error('form_egress_routes_through_email');
  },
};
