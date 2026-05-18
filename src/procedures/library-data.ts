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
    'Collect refund context, inspect policy evidence, lookup the customer, and gate approved refunds.',
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
      id: 'lookup_customer',
      type: 'call_action',
      tool: 'stripe.customers.search',
      args: { email: '{{ customer.email }}' },
      requires_approval: false,
      save_as: 'stripe_customer',
    },
    {
      id: 'refund_gate',
      type: 'if',
      condition: { var: 'refund.approved', equals: true },
      // biome-ignore lint/suspicious/noThenProperty: Procedure specs intentionally use if/then/else terminology.
      then: [
        {
          id: 'create_refund',
          type: 'call_action',
          tool: 'stripe.refunds.create',
          args: {
            charge_id: '{{ refund.charge_id }}',
            amount_cents: '{{ refund.amount_cents }}',
          },
          requires_approval: true,
          save_as: 'refund_result',
        },
      ],
      else: [
        {
          id: 'add_context_note',
          type: 'add_note',
          body: 'Refund intake started. Top policy hit: {{ policy.hits.0.title }}',
        },
      ],
    },
  ],
  evals: [
    {
      name: 'basic_refund_ticket',
      input: {
        ticket: { subject: 'Refund request' },
        customer: { email: 'customer@example.com' },
        refund: { approved: false },
      },
      expect: {
        status: 'completed',
        steps: ['find_policy', 'lookup_customer', 'refund_gate', 'add_context_note'],
        step_statuses: { lookup_customer: 'completed' },
      },
    },
    {
      name: 'approved_refund_waits_for_operator',
      input: {
        ticket: { subject: 'Refund request' },
        customer: { email: 'customer@example.com' },
        refund: { approved: true, charge_id: 'ch_123', amount_cents: 2500 },
      },
      expect: {
        status: 'waiting',
        steps: ['find_policy', 'lookup_customer', 'refund_gate', 'create_refund'],
        step_statuses: { create_refund: 'waiting' },
        step_inputs: {
          create_refund: { 'args.charge_id': 'ch_123', 'args.amount_cents': 2500 },
        },
      },
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
      id: 'has_identifier',
      type: 'if',
      condition: { var: 'customer.identifier', exists: true },
      // biome-ignore lint/suspicious/noThenProperty: Procedure specs intentionally use if/then/else terminology.
      then: [
        {
          id: 'lookup_identity',
          type: 'call_action',
          tool: 'identity.users.lookup',
          args: { identifier: '{{ customer.identifier }}' },
          requires_approval: false,
          save_as: 'identity_lookup',
        },
        {
          id: 'has_user_id',
          type: 'if',
          condition: { var: 'customer.user_id', exists: true },
          // biome-ignore lint/suspicious/noThenProperty: Procedure specs intentionally use if/then/else terminology.
          then: [
            {
              id: 'create_reset_request',
              type: 'call_action',
              tool: 'identity.password_resets.create',
              args: { user_id: '{{ customer.user_id }}' },
              requires_approval: true,
              save_as: 'password_reset_request',
            },
          ],
          else: [
            {
              id: 'ask_user_id',
              type: 'ask_customer',
              subject: 'Re: {{ ticket.subject }}',
              message:
                'I found the account context. Please confirm the account email or username again, and do not include passwords or one-time codes.',
            },
          ],
        },
      ],
      else: [
        {
          id: 'ask_identifier',
          type: 'ask_customer',
          subject: 'Re: {{ ticket.subject }}',
          message:
            'I can help with that. Please send the account email or username, and do not include your password or one-time codes.',
        },
      ],
    },
  ],
  evals: [
    {
      name: 'waits_for_identifier',
      input: { ticket: { subject: 'I cannot log in' } },
      expect: { status: 'waiting', steps: ['find_policy', 'has_identifier', 'ask_identifier'] },
    },
    {
      name: 'reset_request_waits_for_operator',
      input: {
        ticket: { subject: 'I cannot log in' },
        customer: { identifier: 'customer@example.com', user_id: 'user_123' },
      },
      expect: {
        status: 'waiting',
        steps: [
          'find_policy',
          'has_identifier',
          'lookup_identity',
          'has_user_id',
          'create_reset_request',
        ],
        step_statuses: { lookup_identity: 'completed', create_reset_request: 'waiting' },
        step_inputs: {
          create_reset_request: { 'args.user_id': 'user_123' },
        },
      },
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
      id: 'has_order_query',
      type: 'if',
      condition: { var: 'order.query', exists: true },
      // biome-ignore lint/suspicious/noThenProperty: Procedure specs intentionally use if/then/else terminology.
      then: [
        {
          id: 'search_order',
          type: 'call_action',
          tool: 'shopify.orders.search',
          args: { query: '{{ order.query }}' },
          requires_approval: false,
          save_as: 'order_matches',
        },
        {
          id: 'add_order_note',
          type: 'add_note',
          body: 'Shipping dispute prepared for {{ order.query }}.',
        },
      ],
      else: [
        {
          id: 'ask_order',
          type: 'ask_customer',
          subject: 'Re: {{ ticket.subject }}',
          message:
            'Please send your order number and confirm whether the shipment is delayed, missing, or arrived damaged.',
        },
      ],
    },
  ],
  evals: [
    {
      name: 'collects_order_context',
      input: { ticket: { subject: 'Package never arrived' } },
      expect: {
        status: 'waiting',
        context: { 'ticket.category': 'shipping' },
        steps: ['find_shipping_policy', 'set_category', 'has_order_query', 'ask_order'],
      },
    },
    {
      name: 'looks_up_known_order',
      input: {
        ticket: { subject: 'Package never arrived' },
        order: { query: '#1001' },
      },
      expect: {
        status: 'completed',
        context: { 'ticket.category': 'shipping' },
        steps: [
          'find_shipping_policy',
          'set_category',
          'has_order_query',
          'search_order',
          'add_order_note',
        ],
        step_statuses: { search_order: 'completed' },
        step_inputs: {
          search_order: { 'args.query': '#1001' },
        },
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
    {
      id: 'create_privacy_request',
      type: 'call_action',
      tool: 'privacy.requests.create',
      args: { ticket_id: '{{ ticket_id }}' },
      requires_approval: true,
      save_as: 'privacy_request',
    },
  ],
  evals: [
    {
      name: 'escalates_privacy_request',
      input: { ticket_id: 'tkt_privacy', ticket: { subject: 'Delete my account data' } },
      expect: {
        status: 'waiting',
        context: { 'ticket.priority': 'high', 'ticket.category': 'privacy' },
        steps: ['set_priority', 'set_category', 'escalate_privacy', 'create_privacy_request'],
        step_statuses: { create_privacy_request: 'waiting' },
        step_inputs: {
          create_privacy_request: { 'args.ticket_id': 'tkt_privacy' },
        },
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
