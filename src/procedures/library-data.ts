import type {
  ProcedureLibraryItem,
  ProcedureLibraryMcpToolSpec,
  ProcedureSpec,
} from '../types/procedure';
import { identityTools, privacyTools, shopifyTools, stripeRefundTools } from './library-mcp-tools';
import { normalizeProcedureSpec } from './schema';

export type ProcedureLibrarySeedItem = Omit<ProcedureLibraryItem, 'provenance'>;

const refundIntake = normalizeProcedureSpec({
  slug: 'refund-intake',
  name: 'Refund intake',
  version: '1.0.0',
  description:
    'Collect refund context, inspect policy evidence, and leave the ticket ready for action.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'find_policy',
      type: 'search',
      query: 'refund policy for {{ ticket.subject }}',
      scope: 'knowledge',
      max_hops: 2,
      save_as: 'policy',
    },
    {
      id: 'add_context_note',
      type: 'add_note',
      body: 'Refund intake started. Top policy hit: {{ policy.hits.0.title }}',
    },
  ],
  evals: [
    {
      name: 'basic_refund_ticket',
      input: { ticket: { subject: 'Refund request' } },
      expect: { status: 'completed', steps: ['find_policy', 'add_context_note'] },
    },
  ],
});

const passwordReset = normalizeProcedureSpec({
  slug: 'password-reset',
  name: 'Password reset',
  version: '1.0.0',
  description: 'Verifies account-recovery policy and collects the information needed for a reset.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'password_reset' },
  steps: [
    {
      id: 'find_policy',
      type: 'search',
      query: 'password reset account recovery verification policy',
      scope: 'knowledge',
      max_hops: 2,
      save_as: 'policy',
    },
    {
      id: 'ask_identifier',
      type: 'ask_customer',
      subject: 'Re: {{ ticket.subject }}',
      message:
        'I can help with that. Please send the account email or username, and do not include your password or one-time codes.',
    },
  ],
  evals: [
    {
      name: 'waits_for_identifier',
      input: { ticket: { subject: 'I cannot log in' } },
      expect: { status: 'waiting', steps: ['find_policy', 'ask_identifier'] },
    },
  ],
});

const shippingDispute = normalizeProcedureSpec({
  slug: 'shipping-dispute',
  name: 'Shipping dispute',
  version: '1.0.0',
  description: 'Triage delayed, missing, or damaged shipments and collect order context.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'shipping_dispute' },
  steps: [
    {
      id: 'find_shipping_policy',
      type: 'search',
      query: 'shipping delay missing damaged order policy {{ ticket.subject }}',
      scope: 'knowledge',
      max_hops: 3,
      save_as: 'shipping_policy',
    },
    { id: 'set_category', type: 'set_ticket_field', field: 'category', value: 'shipping' },
    {
      id: 'ask_order',
      type: 'ask_customer',
      subject: 'Re: {{ ticket.subject }}',
      message:
        'Please send your order number and confirm whether the shipment is delayed, missing, or arrived damaged.',
    },
  ],
  evals: [
    {
      name: 'collects_order_context',
      input: { ticket: { subject: 'Package never arrived' } },
      expect: {
        status: 'waiting',
        context: { 'ticket.category': 'shipping' },
        steps: ['find_shipping_policy', 'set_category', 'ask_order'],
      },
    },
  ],
});

const gdprRequest = normalizeProcedureSpec({
  slug: 'gdpr-data-request',
  name: 'GDPR data request',
  version: '1.0.0',
  description: 'Escalates privacy data access or deletion requests with the required urgency.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'privacy_request' },
  steps: [
    { id: 'set_priority', type: 'set_ticket_field', field: 'priority', value: 'high' },
    { id: 'set_category', type: 'set_ticket_field', field: 'category', value: 'privacy' },
    {
      id: 'escalate_privacy',
      type: 'escalate_to',
      route_to: 'privacy',
      severity: 'high',
      reason: 'Potential data access/deletion request requires privacy-owner review.',
    },
  ],
  evals: [
    {
      name: 'escalates_privacy_request',
      input: { ticket: { subject: 'Delete my account data' } },
      expect: {
        status: 'completed',
        context: { 'ticket.priority': 'high', 'ticket.category': 'privacy' },
        steps: ['set_priority', 'set_category', 'escalate_privacy'],
      },
    },
  ],
});

export const PROCEDURE_LIBRARY: ProcedureLibrarySeedItem[] = [
  entry(
    refundIntake,
    'billing',
    'Collect refund context with policy evidence.',
    'medium',
    ['refund', 'billing', 'policy'],
    ['stripe'],
    stripeRefundTools,
  ),
  entry(
    passwordReset,
    'account',
    'Collect safe account-recovery context without requesting secrets.',
    'medium',
    ['login', 'identity', 'security'],
    ['identity'],
    identityTools,
  ),
  entry(
    shippingDispute,
    'shipping',
    'Prepare delayed, missing, or damaged shipment tickets.',
    'low',
    ['shipping', 'orders', 'returns'],
    ['shopify'],
    shopifyTools,
  ),
  entry(
    gdprRequest,
    'privacy',
    'Escalate privacy data requests to the right owner.',
    'high',
    ['privacy', 'gdpr', 'escalation'],
    ['privacy'],
    privacyTools,
  ),
];

function entry(
  spec: ProcedureSpec,
  category: ProcedureLibraryItem['category'],
  summary: string,
  riskLevel: ProcedureLibraryItem['risk_level'],
  tags: string[],
  requiredMcpServers: string[],
  referenceMcpTools: ProcedureLibraryMcpToolSpec[],
): ProcedureLibrarySeedItem {
  return {
    slug: spec.slug,
    name: spec.name,
    summary,
    category,
    tags,
    risk_level: riskLevel,
    required_mcp_servers: requiredMcpServers,
    eval_count: spec.evals?.length ?? 0,
    version: spec.version,
    spec,
    reference_mcp_tools: referenceMcpTools,
  };
}
