import type { ChannelAdapter } from '../../types/channels';
import { EMAIL_CAPS } from '../capabilities';

// Email is the wedge — it predates the adapter abstraction and lives in
// `src/email/`. The adapter here exists so the registry can answer
// `getAdapter('email')` consistently (capabilities, validateConfig). The
// outbound dispatcher short-circuits 'email' to the legacy reply pipeline,
// because email outbound needs MIME threading, signed reply addresses, and
// the dedicated DKIM-signing subdomain that the rest of `src/email/`
// already owns.

export const emailAdapter: ChannelAdapter = {
  kind: 'email',
  capabilities: EMAIL_CAPS,
  validateConfig: () => ({}),
  verifyWebhook: async () => ({ ok: false, reason: 'email_uses_cloudflare_routing' }),
  parseIngress: async () => null,
  egress: async () => {
    // Outbound email is owned by `src/agents/supervisor/replies.ts`; the
    // dispatcher never reaches this adapter for 'email' (it short-circuits).
    // Keep this body as a guard so misuse fails loud.
    throw new Error('email_egress_handled_by_reply_pipeline');
  },
};
