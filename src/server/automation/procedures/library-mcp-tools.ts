import type { ProcedureLibraryMcpToolSpec } from '../../../types/shared/procedure';

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

export const identityChannelTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'identity',
    tool: 'otp.send',
    title: 'Send identity-proof OTP',
    description:
      'Deliver a one-time verification code over a channel that supports OTP (SMS, Telegram, WhatsApp).',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        destination: { type: 'string' },
      },
      required: ['channel', 'destination'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    server: 'identity',
    tool: 'magic_link.send',
    title: 'Send identity magic link',
    description:
      'Email a single-use verification link when the originating channel cannot deliver an OTP.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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

// Phase 11 Action Library — MCP contracts the reference procedures below
// consume. Every contract documents the read-only / destructive annotations so
// the procedure runner enforces the right approval gate on `call_action`.

export const shopifyAddressTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'shopify',
    tool: 'orders.retrieve',
    title: 'Retrieve Shopify order',
    description: 'Load an order for shipping-address edits or fulfillment status checks.',
    input_schema: {
      type: 'object',
      properties: { order_id: { type: 'string' } },
      required: ['order_id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    server: 'shopify',
    tool: 'orders.update_address',
    title: 'Update Shopify order address',
    description:
      'Replace the shipping address on an unfulfilled Shopify order. Destructive — needs operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        address1: { type: 'string' },
        address2: { type: 'string' },
        city: { type: 'string' },
        province: { type: 'string' },
        postal_code: { type: 'string' },
        country: { type: 'string' },
      },
      required: ['order_id', 'address1', 'city', 'country'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];

export const rechargeSubscriptionTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'recharge',
    tool: 'subscriptions.retrieve',
    title: 'Retrieve Recharge subscription',
    description: 'Load a subscription by id or customer email to confirm current cadence.',
    input_schema: {
      type: 'object',
      properties: { subscription_id: { type: 'string' }, email: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    server: 'recharge',
    tool: 'subscriptions.pause',
    title: 'Pause Recharge subscription',
    description: 'Pause an active subscription until a chosen resume date.',
    input_schema: {
      type: 'object',
      properties: {
        subscription_id: { type: 'string' },
        pause_until: { type: 'string', format: 'date' },
      },
      required: ['subscription_id', 'pause_until'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
];

export const salesforceCaseTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'salesforce',
    tool: 'contacts.retrieve',
    title: 'Retrieve Salesforce contact',
    description: 'Load contact details by email to enrich the ticket with account/owner context.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    server: 'salesforce',
    tool: 'cases.create',
    title: 'Create Salesforce case',
    description: 'Mirror the ticket as a Salesforce case for the account team to action.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        subject: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string' },
      },
      required: ['subject'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const hubspotTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'hubspot',
    tool: 'contacts.search',
    title: 'Search HubSpot contacts',
    description: 'Find a HubSpot contact by email to attach support context.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    server: 'hubspot',
    tool: 'deals.retrieve',
    title: 'Retrieve HubSpot deal',
    description: 'Load deal context for a contact to prioritize ticket handling.',
    input_schema: {
      type: 'object',
      properties: { deal_id: { type: 'string' } },
      required: ['deal_id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    usage: 'optional',
  },
];

export const pagerDutyTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'pagerduty',
    tool: 'incidents.create',
    title: 'Create PagerDuty incident',
    description: 'Page an on-call team for a confirmed outage report.',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string' },
        title: { type: 'string' },
        urgency: { type: 'string', enum: ['high', 'low'] },
        body: { type: 'string' },
      },
      required: ['service_id', 'title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];

export const jiraTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'jira',
    tool: 'issues.search',
    title: 'Search Jira issues',
    description: 'Find an existing Jira issue for the customer-reported bug.',
    input_schema: {
      type: 'object',
      properties: { jql: { type: 'string' } },
      required: ['jql'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    server: 'jira',
    tool: 'issues.create',
    title: 'Create Jira issue',
    description: 'Create a new Jira issue for engineering to triage.',
    input_schema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        issue_type: { type: 'string' },
      },
      required: ['project_key', 'summary'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const zendeskImportTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'zendesk',
    tool: 'tickets.list',
    title: 'List Zendesk tickets',
    description: 'Read-only Zendesk export to seed Ranse historical evals during migration.',
    input_schema: {
      type: 'object',
      properties: { since: { type: 'string', format: 'date-time' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export const klaviyoTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'klaviyo',
    tool: 'profiles.search',
    title: 'Search Klaviyo profile',
    description: 'Find the customer profile by email to confirm subscription state.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    server: 'klaviyo',
    tool: 'profiles.suppress',
    title: 'Suppress Klaviyo profile',
    description: 'Mark a profile suppressed so they stop receiving marketing emails.',
    input_schema: {
      type: 'object',
      properties: { profile_id: { type: 'string' }, reason: { type: 'string' } },
      required: ['profile_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
];

export const auth0Tools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'auth0',
    tool: 'users.search',
    title: 'Search Auth0 user',
    description: 'Find an Auth0 user by email before issuing a password-change ticket.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    server: 'auth0',
    tool: 'tickets.password_change',
    title: 'Issue Auth0 password-change ticket',
    description: 'Create a signed password-change link Auth0 will email to the user.',
    input_schema: {
      type: 'object',
      properties: { user_id: { type: 'string' } },
      required: ['user_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export const notionTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'notion',
    tool: 'databases.query',
    title: 'Query Notion database',
    description: 'Pull internal runbook / SOP pages relevant to the ticket category.',
    input_schema: {
      type: 'object',
      properties: { database_id: { type: 'string' }, filter: { type: 'object' } },
      required: ['database_id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    server: 'notion',
    tool: 'pages.create',
    title: 'Create Notion page',
    description: 'Hand a structured summary off to the docs team as a Notion page.',
    input_schema: {
      type: 'object',
      properties: { parent_id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
      required: ['parent_id', 'title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const datadogTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'datadog',
    tool: 'events.create',
    title: 'Create Datadog event',
    description: 'Cross-post a customer-reported incident as a Datadog event for correlation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export const snowflakeTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'snowflake',
    tool: 'query.execute',
    title: 'Execute Snowflake query',
    description:
      'Run a read-only query against an analytics warehouse to look up account usage / billing rows.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' }, max_rows: { type: 'integer' } },
      required: ['sql'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export const mixpanelTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'mixpanel',
    tool: 'events.query',
    title: 'Query Mixpanel events',
    description: 'Surface recent product-usage events for the customer reporting the issue.',
    input_schema: {
      type: 'object',
      properties: { distinct_id: { type: 'string' }, from_date: { type: 'string' } },
      required: ['distinct_id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export const slackTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'slack',
    tool: 'conversations.history',
    title: 'Read Slack conversation history',
    description: 'Read recent Slack messages in a shared customer channel.',
    input_schema: {
      type: 'object',
      properties: { channel_id: { type: 'string' }, limit: { type: 'integer' } },
      required: ['channel_id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    server: 'slack',
    tool: 'chat.post_message',
    title: 'Post Slack message',
    description: 'Send an outbound message into a shared Slack channel.',
    input_schema: {
      type: 'object',
      properties: { channel_id: { type: 'string' }, text: { type: 'string' } },
      required: ['channel_id', 'text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const calendlyTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'calendly',
    tool: 'scheduled_events.list',
    title: 'List Calendly scheduled events',
    description: 'Look up upcoming Calendly bookings the customer has on file.',
    input_schema: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export const twilioVerifyTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'twilio-verify',
    tool: 'verifications.create',
    title: 'Send Twilio verification',
    description: 'Send an SMS or voice verification code through Twilio Verify.',
    input_schema: {
      type: 'object',
      properties: { to: { type: 'string' }, channel: { type: 'string', enum: ['sms', 'call'] } },
      required: ['to', 'channel'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const linearTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'linear',
    tool: 'issues.create',
    title: 'Create Linear issue',
    description: 'Escalate a customer-reported bug as a Linear issue tagged with the support ticket.',
    input_schema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'integer' },
      },
      required: ['team_id', 'title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const githubTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'github',
    tool: 'issues.create',
    title: 'Create GitHub issue',
    description: 'Open a GitHub issue in the relevant repository for engineering follow-up.',
    input_schema: {
      type: 'object',
      properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
      required: ['owner', 'repo', 'title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const webhookTools: ProcedureLibraryMcpToolSpec[] = [
  {
    server: 'webhook',
    tool: 'webhook.call',
    title: 'Call generic webhook',
    description:
      'Invoke an HTTP endpoint owned by the workspace; arguments and payload are signed via the webhook adapter.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, payload: { type: 'object' } },
      required: ['name'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];
