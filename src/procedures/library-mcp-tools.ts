import type { ProcedureLibraryMcpToolSpec } from '../types/procedure';

export const stripeRefundTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'stripe',
    tool: 'customers.search',
    title: 'Search Stripe customers',
    description:
      'Find a customer record by email or customer id before reviewing refund eligibility.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    server: 'stripe',
    tool: 'refunds.create',
    title: 'Create Stripe refund',
    description: 'Create a refund after policy and operator approval gates pass.',
    input_schema: {
      type: 'object',
      properties: { charge_id: { type: 'string' }, amount_cents: { type: 'integer' } },
      required: ['charge_id', 'amount_cents'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

export const identityTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'identity',
    tool: 'users.lookup',
    title: 'Lookup identity user',
    description: 'Lookup the account record after the customer provides an email or username.',
    input_schema: {
      type: 'object',
      properties: { identifier: { type: 'string' } },
      required: ['identifier'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    server: 'identity',
    tool: 'password_resets.create',
    title: 'Create password-reset ticket',
    description: 'Create an internal password-reset request after verification gates pass.',
    input_schema: {
      type: 'object',
      properties: { user_id: { type: 'string' } },
      required: ['user_id'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

export const shopifyTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'shopify',
    tool: 'orders.search',
    title: 'Search Shopify orders',
    description: 'Find candidate orders by email, order number, or tracking number.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
];

export const privacyTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'privacy',
    tool: 'requests.create',
    title: 'Create privacy request',
    description: 'Open a tracked data-access or deletion request in the privacy system.',
    input_schema: {
      type: 'object',
      properties: { ticket_id: { type: 'string' } },
      required: ['ticket_id'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
