import type {
  ProcedureLibraryItem,
  ProcedureLibraryMcpToolSpec,
  ProcedureSpec,
} from '../../types/procedure';
import {
  auth0Tools,
  calendlyTools,
  datadogTools,
  githubTools,
  hubspotTools,
  identityChannelTools,
  identityTools,
  jiraTools,
  klaviyoTools,
  linearTools,
  mixpanelTools,
  notionTools,
  pagerDutyTools,
  privacyTools,
  rechargeSubscriptionTools,
  salesforceCaseTools,
  shopifyAddressTools,
  shopifyTools,
  slackTools,
  snowflakeTools,
  stripeRefundTools,
  twilioVerifyTools,
  webhookTools,
  zendeskImportTools,
} from './library-mcp-tools';
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

const verifyIdentityChannelAware = normalizeProcedureSpec({
  slug: 'verify-identity-channel-aware',
  name: 'Verify identity (channel-aware)',
  version: '1.0.0',
  description:
    'Choose the strongest identity-proof method available on the originating channel: SMS OTP, Telegram OTP, magic link over email, or fall back to operator review.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'verify_identity' },
  steps: [
    {
      id: 'route_by_capability',
      type: 'if',
      condition: { var: 'channel.capabilities.supportsOtpDelivery', equals: true },
      // biome-ignore lint/suspicious/noThenProperty: Procedure specs intentionally use if/then/else terminology.
      then: [
        {
          id: 'request_otp_delivery',
          type: 'call_action',
          tool: 'identity.otp.send',
          args: {
            channel: '{{ channel.kind }}',
            destination: '{{ ticket.requester_email }}',
          },
          requires_approval: true,
          save_as: 'otp_request',
        },
      ],
      else: [
        {
          id: 'send_magic_link',
          type: 'call_action',
          tool: 'identity.magic_link.send',
          args: { email: '{{ ticket.requester_email }}' },
          requires_approval: true,
          save_as: 'magic_link_request',
        },
      ],
    },
  ],
  evals: [
    {
      name: 'sms_channel_sends_otp',
      input: {
        ticket: { subject: 'Locked out' },
        channel: {
          kind: 'sms',
          capabilities: { supportsOtpDelivery: true },
        },
      },
      expect: {
        status: 'waiting',
        steps: ['route_by_capability', 'request_otp_delivery'],
        step_statuses: { request_otp_delivery: 'waiting' },
      },
    },
    {
      name: 'chat_channel_falls_back_to_magic_link',
      input: {
        ticket: { subject: 'Locked out', requester_email: 'cx@example.com' },
        channel: {
          kind: 'chat',
          capabilities: { supportsOtpDelivery: false },
        },
      },
      expect: {
        status: 'waiting',
        steps: ['route_by_capability', 'send_magic_link'],
        step_statuses: { send_magic_link: 'waiting' },
      },
    },
  ],
});

// Phase 11 Action Library reference procedures. Each consumes one of the new
// first-party MCP templates so an operator can install the procedure, point
// the matching MCP server at it, and have an executable workflow on day one.

const orderAddressEdit = normalizeProcedureSpec({
  slug: 'order-address-edit',
  name: 'Order address edit',
  version: '1.0.0',
  description: 'Update a shipping address on an unfulfilled Shopify order after operator review.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'change_address' },
  steps: [
    {
      id: 'load_order',
      type: 'call_action',
      tool: 'shopify.orders.retrieve',
      args: { order_id: '{{ order.id }}' },
      requires_approval: false,
      save_as: 'order',
    },
    {
      id: 'update_address',
      type: 'call_action',
      tool: 'shopify.orders.update_address',
      args: {
        order_id: '{{ order.id }}',
        address1: '{{ address.address1 }}',
        city: '{{ address.city }}',
        country: '{{ address.country }}',
      },
      requires_approval: true,
      save_as: 'updated',
    },
    {
      id: 'note_change',
      type: 'add_note',
      body: 'Address updated for order {{ order.id }} pending operator confirmation.',
    },
  ],
  evals: [
    {
      name: 'address_edit_waits_for_approval',
      input: {
        order: { id: 'gid://shopify/Order/1' },
        address: { address1: '1 Test St', city: 'Auckland', country: 'NZ' },
      },
      expect: {
        status: 'waiting',
        steps: ['load_order', 'update_address'],
        step_statuses: { update_address: 'waiting' },
      },
    },
  ],
});

const subscriptionPause = normalizeProcedureSpec({
  slug: 'subscription-pause',
  name: 'Subscription pause',
  version: '1.0.0',
  description: 'Pause an active Recharge subscription with operator approval.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'pause_subscription' },
  steps: [
    {
      id: 'retrieve',
      type: 'call_action',
      tool: 'recharge.subscriptions.retrieve',
      args: { subscription_id: '{{ subscription.id }}' },
      requires_approval: false,
      save_as: 'subscription',
    },
    {
      id: 'pause',
      type: 'call_action',
      tool: 'recharge.subscriptions.pause',
      args: { subscription_id: '{{ subscription.id }}', pause_until: '{{ subscription.pause_until }}' },
      requires_approval: true,
      save_as: 'paused',
    },
    {
      id: 'confirm',
      type: 'add_note',
      body: 'Subscription {{ subscription.id }} paused until {{ subscription.pause_until }}.',
    },
  ],
  evals: [
    {
      name: 'pause_waits_for_approval',
      input: { subscription: { id: 'sub_1', pause_until: '2026-06-01' } },
      expect: {
        status: 'waiting',
        steps: ['retrieve', 'pause'],
        step_statuses: { pause: 'waiting' },
      },
    },
  ],
});

const enterpriseEscalation = normalizeProcedureSpec({
  slug: 'enterprise-escalation',
  name: 'Enterprise escalation',
  version: '1.0.0',
  description: 'Enrich the ticket with Salesforce contact context and mirror as a case.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'contact',
      type: 'call_action',
      tool: 'salesforce.contacts.retrieve',
      args: { email: '{{ customer.email }}' },
      requires_approval: false,
      save_as: 'contact',
    },
    {
      id: 'mirror',
      type: 'call_action',
      tool: 'salesforce.cases.create',
      args: {
        contact_id: '{{ contact.id }}',
        subject: '{{ ticket.subject }}',
        description: '{{ ticket.summary }}',
      },
      requires_approval: true,
      save_as: 'case',
    },
    { id: 'set_priority', type: 'set_ticket_field', field: 'priority', value: 'high' },
  ],
  evals: [
    {
      name: 'mirrors_to_salesforce_waits_for_approval',
      input: {
        customer: { email: 'enterprise@example.com' },
        ticket: { subject: 'Critical', summary: 'Outage in tenant X' },
        contact: { id: '003xx' },
      },
      expect: {
        status: 'waiting',
        steps: ['contact', 'mirror'],
        step_statuses: { mirror: 'waiting' },
      },
    },
  ],
});

const crmContextSync = normalizeProcedureSpec({
  slug: 'crm-context-sync',
  name: 'CRM context sync',
  version: '1.0.0',
  description: 'Annotate a ticket with HubSpot contact + open-deal context.',
  owner: 'ranse-library',
  trigger: { type: 'ticket_created' },
  steps: [
    {
      id: 'lookup_contact',
      type: 'call_action',
      tool: 'hubspot.contacts.search',
      args: { email: '{{ customer.email }}' },
      requires_approval: false,
      save_as: 'contact',
    },
    {
      id: 'note',
      type: 'add_note',
      body: 'HubSpot contact: {{ contact.id }} ({{ contact.lifecycle_stage }}).',
    },
  ],
  evals: [
    {
      name: 'attaches_contact_context',
      input: { customer: { email: 'lead@example.com' }, contact: { id: 'c1', lifecycle_stage: 'lead' } },
      expect: { status: 'completed', steps: ['lookup_contact', 'note'] },
    },
  ],
});

const outageReport = normalizeProcedureSpec({
  slug: 'outage-report',
  name: 'Outage report',
  version: '1.0.0',
  description: 'Open a PagerDuty incident and a Datadog event when customer reports confirm an outage.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'page',
      type: 'call_action',
      tool: 'pagerduty.incidents.create',
      args: {
        service_id: '{{ incident.service_id }}',
        title: '{{ ticket.subject }}',
        urgency: 'high',
        body: '{{ ticket.summary }}',
      },
      requires_approval: true,
      save_as: 'page_result',
    },
    {
      id: 'crosspost',
      type: 'call_action',
      tool: 'datadog.events.create',
      args: { title: 'Customer-reported outage', text: '{{ ticket.summary }}', tags: ['source:ranse'] },
      requires_approval: true,
      save_as: 'datadog_event',
    },
  ],
  evals: [
    {
      name: 'pages_waits_for_approval',
      input: { incident: { service_id: 'P1' }, ticket: { subject: 'Down', summary: '503' } },
      expect: { status: 'waiting', step_statuses: { page: 'waiting' } },
    },
  ],
});

const jiraBugEscalation = normalizeProcedureSpec({
  slug: 'jira-bug-escalation',
  name: 'Jira bug escalation',
  version: '1.0.0',
  description: 'Create a Jira issue once a bug ticket has been reproduced.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'bug_report' },
  steps: [
    {
      id: 'search_existing',
      type: 'call_action',
      tool: 'jira.issues.search',
      args: { jql: 'project = SUPPORT AND text ~ "{{ ticket.subject }}"' },
      requires_approval: false,
      save_as: 'existing',
    },
    {
      id: 'gate',
      type: 'if',
      condition: { var: 'existing.matches', exists: true },
      // biome-ignore lint/suspicious/noThenProperty: Procedure spec key.
      then: [{ id: 'note_match', type: 'add_note', body: 'Existing Jira: {{ existing.matches.0.key }}' }],
      else: [
        {
          id: 'create_issue',
          type: 'call_action',
          tool: 'jira.issues.create',
          args: {
            project_key: 'SUPPORT',
            summary: '{{ ticket.subject }}',
            description: '{{ ticket.summary }}',
            issue_type: 'Bug',
          },
          requires_approval: true,
          save_as: 'issue',
        },
      ],
    },
  ],
  evals: [
    {
      name: 'creates_jira_when_no_match',
      input: { ticket: { subject: 'Crash on save', summary: 'Reported by 3 customers' } },
      expect: {
        status: 'waiting',
        steps: ['search_existing', 'gate', 'create_issue'],
        step_statuses: { create_issue: 'waiting' },
      },
    },
  ],
});

const zendeskMigrationImport = normalizeProcedureSpec({
  slug: 'zendesk-migration-import',
  name: 'Zendesk migration import',
  version: '1.0.0',
  description: 'Pull historical Zendesk tickets to seed Ranse evals during migration.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'fetch_recent',
      type: 'call_action',
      tool: 'zendesk.tickets.list',
      args: { since: '{{ migration.since }}' },
      requires_approval: false,
      save_as: 'tickets',
    },
    { id: 'note', type: 'add_note', body: 'Imported {{ tickets.count }} historical tickets.' },
  ],
  evals: [
    {
      name: 'imports_history',
      input: { migration: { since: '2025-01-01' }, tickets: { count: 42 } },
      expect: { status: 'completed', steps: ['fetch_recent', 'note'] },
    },
  ],
});

const unsubscribeConfirmation = normalizeProcedureSpec({
  slug: 'unsubscribe-confirmation',
  name: 'Unsubscribe confirmation',
  version: '1.0.0',
  description: 'Suppress a Klaviyo profile and confirm the unsubscribe to the customer.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'unsubscribe' },
  steps: [
    {
      id: 'lookup',
      type: 'call_action',
      tool: 'klaviyo.profiles.search',
      args: { email: '{{ customer.email }}' },
      requires_approval: false,
      save_as: 'profile',
    },
    {
      id: 'suppress',
      type: 'call_action',
      tool: 'klaviyo.profiles.suppress',
      args: { profile_id: '{{ profile.id }}', reason: 'customer_request' },
      requires_approval: true,
      save_as: 'suppression',
    },
  ],
  evals: [
    {
      name: 'suppress_waits_for_approval',
      input: { customer: { email: 'opt@example.com' }, profile: { id: 'p1' } },
      expect: { status: 'waiting', step_statuses: { suppress: 'waiting' } },
    },
  ],
});

const auth0PasswordReset = normalizeProcedureSpec({
  slug: 'auth0-password-reset',
  name: 'Auth0 password reset',
  version: '1.0.0',
  description: 'Issue an Auth0 password-change ticket once the user is verified.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'password_reset' },
  steps: [
    {
      id: 'find_user',
      type: 'call_action',
      tool: 'auth0.users.search',
      args: { email: '{{ customer.email }}' },
      requires_approval: false,
      save_as: 'user',
    },
    {
      id: 'issue_ticket',
      type: 'call_action',
      tool: 'auth0.tickets.password_change',
      args: { user_id: '{{ user.id }}' },
      requires_approval: true,
      save_as: 'ticket',
    },
  ],
  evals: [
    {
      name: 'issues_password_change_waits_for_approval',
      input: { customer: { email: 'a@example.com' }, user: { id: 'auth0|1' } },
      expect: {
        status: 'waiting',
        steps: ['find_user', 'issue_ticket'],
        step_statuses: { issue_ticket: 'waiting' },
      },
    },
  ],
});

const docsHandoff = normalizeProcedureSpec({
  slug: 'docs-handoff',
  name: 'Docs handoff',
  version: '1.0.0',
  description: 'Hand a structured summary to the docs team as a Notion page.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'lookup_runbook',
      type: 'call_action',
      tool: 'notion.databases.query',
      args: { database_id: '{{ docs.database_id }}' },
      requires_approval: false,
      save_as: 'runbook',
    },
    {
      id: 'create_page',
      type: 'call_action',
      tool: 'notion.pages.create',
      args: {
        parent_id: '{{ docs.database_id }}',
        title: '{{ ticket.subject }}',
        body: '{{ ticket.summary }}',
      },
      requires_approval: true,
      save_as: 'page',
    },
  ],
  evals: [
    {
      name: 'creates_docs_page_waits_for_approval',
      input: { docs: { database_id: 'db_1' }, ticket: { subject: 'Q', summary: 'A' } },
      expect: {
        status: 'waiting',
        steps: ['lookup_runbook', 'create_page'],
        step_statuses: { create_page: 'waiting' },
      },
    },
  ],
});

const usageLookup = normalizeProcedureSpec({
  slug: 'usage-lookup',
  name: 'Usage lookup',
  version: '1.0.0',
  description: 'Pull the customer recent usage rows from the analytics warehouse.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'query',
      type: 'call_action',
      tool: 'snowflake.query.execute',
      args: {
        sql: "SELECT day, calls FROM usage WHERE account_id = '{{ customer.id }}' ORDER BY day DESC LIMIT 30",
        max_rows: 30,
      },
      requires_approval: false,
      save_as: 'usage',
    },
    { id: 'note', type: 'add_note', body: 'Pulled {{ usage.rows.length }} usage rows.' },
  ],
  evals: [
    {
      name: 'pulls_usage',
      input: { customer: { id: 'acct_1' }, usage: { rows: [{ day: '2026-05-19', calls: 10 }] } },
      expect: { status: 'completed', steps: ['query', 'note'] },
    },
  ],
});

const engagementContext = normalizeProcedureSpec({
  slug: 'engagement-context',
  name: 'Engagement context',
  version: '1.0.0',
  description: 'Surface recent product-usage events from Mixpanel to enrich the reply.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'fetch_events',
      type: 'call_action',
      tool: 'mixpanel.events.query',
      args: { distinct_id: '{{ customer.id }}', from_date: '{{ window.from }}' },
      requires_approval: false,
      save_as: 'events',
    },
    { id: 'note', type: 'add_note', body: 'Fetched {{ events.count }} events.' },
  ],
  evals: [
    {
      name: 'fetches_events',
      input: { customer: { id: 'u_1' }, window: { from: '2026-05-01' }, events: { count: 12 } },
      expect: { status: 'completed', steps: ['fetch_events', 'note'] },
    },
  ],
});

const sharedChannelEscalation = normalizeProcedureSpec({
  slug: 'shared-channel-escalation',
  name: 'Shared channel escalation',
  version: '1.0.0',
  description: 'Post an escalation message into the shared customer Slack channel.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'history',
      type: 'call_action',
      tool: 'slack.conversations.history',
      args: { channel_id: '{{ slack.channel_id }}', limit: 10 },
      requires_approval: false,
      save_as: 'history',
    },
    {
      id: 'post',
      type: 'call_action',
      tool: 'slack.chat.post_message',
      args: { channel_id: '{{ slack.channel_id }}', text: 'Heads up: {{ ticket.subject }}' },
      requires_approval: true,
      save_as: 'posted',
    },
  ],
  evals: [
    {
      name: 'posts_to_shared_channel_waits_for_approval',
      input: { slack: { channel_id: 'C1' }, ticket: { subject: 'Blocked' } },
      expect: {
        status: 'waiting',
        steps: ['history', 'post'],
        step_statuses: { post: 'waiting' },
      },
    },
  ],
});

const meetingContext = normalizeProcedureSpec({
  slug: 'meeting-context',
  name: 'Meeting context',
  version: '1.0.0',
  description: 'Look up the customer upcoming Calendly bookings to enrich the reply.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'list_events',
      type: 'call_action',
      tool: 'calendly.scheduled_events.list',
      args: { email: '{{ customer.email }}' },
      requires_approval: false,
      save_as: 'events',
    },
    { id: 'note', type: 'add_note', body: '{{ events.count }} upcoming bookings on file.' },
  ],
  evals: [
    {
      name: 'fetches_upcoming',
      input: { customer: { email: 'c@example.com' }, events: { count: 1 } },
      expect: { status: 'completed', steps: ['list_events', 'note'] },
    },
  ],
});

const bugEscalationLinear = normalizeProcedureSpec({
  slug: 'bug-escalation-linear',
  name: 'Bug escalation (Linear)',
  version: '1.0.0',
  description: 'Open a Linear issue for engineering when a customer reproduces a bug.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'bug_report' },
  steps: [
    {
      id: 'create_issue',
      type: 'call_action',
      tool: 'linear.issues.create',
      args: {
        team_id: '{{ engineering.team_id }}',
        title: '{{ ticket.subject }}',
        description: '{{ ticket.summary }}',
        priority: 2,
      },
      requires_approval: true,
      save_as: 'issue',
    },
    { id: 'note', type: 'add_note', body: 'Filed Linear issue {{ issue.identifier }}.' },
  ],
  evals: [
    {
      name: 'creates_linear_issue_waits_for_approval',
      input: {
        engineering: { team_id: 'eng' },
        ticket: { subject: 'Bug', summary: 'Repro steps' },
        issue: { identifier: 'ENG-1' },
      },
      expect: {
        status: 'waiting',
        steps: ['create_issue'],
        step_statuses: { create_issue: 'waiting' },
      },
    },
  ],
});

const featureRequestIntake = normalizeProcedureSpec({
  slug: 'feature-request-intake',
  name: 'Feature request intake',
  version: '1.0.0',
  description: 'Open a GitHub issue in the product repo for a customer feature request.',
  owner: 'ranse-library',
  trigger: { type: 'intent', intent: 'feature_request' },
  steps: [
    {
      id: 'open',
      type: 'call_action',
      tool: 'github.issues.create',
      args: {
        owner: '{{ repo.owner }}',
        repo: '{{ repo.name }}',
        title: '{{ ticket.subject }}',
        body: '{{ ticket.summary }}',
      },
      requires_approval: true,
      save_as: 'issue',
    },
  ],
  evals: [
    {
      name: 'opens_issue_waits_for_approval',
      input: {
        repo: { owner: 'getranse', name: 'ranse' },
        ticket: { subject: 'Feature x', summary: 'why' },
      },
      expect: { status: 'waiting', step_statuses: { open: 'waiting' } },
    },
  ],
});

const internalActionWebhook = normalizeProcedureSpec({
  slug: 'internal-action-webhook',
  name: 'Internal action (webhook)',
  version: '1.0.0',
  description: 'Call a workspace-owned HTTP action through the generic webhook MCP adapter.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'call',
      type: 'call_action',
      tool: 'webhook.webhook.call',
      args: { name: '{{ action.name }}', payload: { ticket_id: '{{ ticket.id }}' } },
      requires_approval: true,
      save_as: 'result',
    },
  ],
  evals: [
    {
      name: 'webhook_requires_approval',
      input: { action: { name: 'do_thing' }, ticket: { id: 't1' } },
      expect: { status: 'waiting', step_statuses: { call: 'waiting' } },
    },
  ],
});

const twilioVerifyChannel = normalizeProcedureSpec({
  slug: 'twilio-verify-otp',
  name: 'Twilio Verify OTP',
  version: '1.0.0',
  description: 'Send an SMS OTP via Twilio Verify for inbound phone-channel identity proof.',
  owner: 'ranse-library',
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'send',
      type: 'call_action',
      tool: 'twilio-verify.verifications.create',
      args: { to: '{{ customer.phone }}', channel: 'sms' },
      requires_approval: true,
      save_as: 'verification',
    },
  ],
  evals: [
    {
      name: 'sends_otp_waits_for_approval',
      input: { customer: { phone: '+15555550100' } },
      expect: { status: 'waiting', step_statuses: { send: 'waiting' } },
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
    verifyIdentityChannelAware,
    'account',
    'Pick the strongest identity-proof method for the originating channel.',
    'medium',
    ['identity', 'channel', 'otp'],
    ['identity'],
    identityChannelTools,
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
  // Phase 11 Action Library
  entry(
    orderAddressEdit,
    'shipping',
    'Edit a Shopify shipping address after operator review.',
    'medium',
    ['shipping', 'orders', 'address'],
    ['shopify'],
    shopifyAddressTools,
  ),
  entry(
    subscriptionPause,
    'billing',
    'Pause a Recharge subscription with operator approval.',
    'medium',
    ['subscription', 'billing'],
    ['recharge'],
    rechargeSubscriptionTools,
  ),
  entry(
    enterpriseEscalation,
    'account',
    'Mirror an enterprise escalation as a Salesforce case.',
    'high',
    ['enterprise', 'escalation', 'crm'],
    ['salesforce'],
    salesforceCaseTools,
  ),
  entry(
    crmContextSync,
    'account',
    'Attach HubSpot contact context on ticket creation.',
    'low',
    ['crm', 'context'],
    ['hubspot'],
    hubspotTools,
  ),
  entry(
    outageReport,
    'incident',
    'Page on-call and cross-post to Datadog when an outage is confirmed.',
    'high',
    ['outage', 'incident', 'on-call'],
    ['pagerduty', 'datadog'],
    [...pagerDutyTools, ...datadogTools],
  ),
  entry(
    jiraBugEscalation,
    'engineering',
    'Open or attach to a Jira issue for a customer-reported bug.',
    'medium',
    ['bug', 'engineering', 'jira'],
    ['jira'],
    jiraTools,
  ),
  entry(
    zendeskMigrationImport,
    'admin',
    'Pull historical Zendesk tickets to seed Ranse evals.',
    'low',
    ['migration', 'zendesk', 'history'],
    ['zendesk'],
    zendeskImportTools,
  ),
  entry(
    unsubscribeConfirmation,
    'privacy',
    'Suppress a Klaviyo profile and confirm the unsubscribe.',
    'medium',
    ['unsubscribe', 'marketing'],
    ['klaviyo'],
    klaviyoTools,
  ),
  entry(
    auth0PasswordReset,
    'account',
    'Issue an Auth0 password-change ticket once the user is verified.',
    'medium',
    ['identity', 'password'],
    ['auth0'],
    auth0Tools,
  ),
  entry(
    docsHandoff,
    'docs',
    'Hand a structured summary off as a Notion page.',
    'low',
    ['docs', 'handoff'],
    ['notion'],
    notionTools,
  ),
  entry(
    usageLookup,
    'analytics',
    'Pull recent usage rows from the analytics warehouse.',
    'low',
    ['usage', 'analytics'],
    ['snowflake'],
    snowflakeTools,
  ),
  entry(
    engagementContext,
    'analytics',
    'Surface recent product-usage events to enrich the reply.',
    'low',
    ['engagement', 'analytics'],
    ['mixpanel'],
    mixpanelTools,
  ),
  entry(
    sharedChannelEscalation,
    'account',
    'Bridge support into a shared customer Slack channel.',
    'medium',
    ['escalation', 'slack'],
    ['slack'],
    slackTools,
  ),
  entry(
    meetingContext,
    'account',
    'Look up the customer upcoming Calendly bookings.',
    'low',
    ['meeting', 'context'],
    ['calendly'],
    calendlyTools,
  ),
  entry(
    bugEscalationLinear,
    'engineering',
    'File a Linear issue for engineering follow-up.',
    'medium',
    ['bug', 'engineering', 'linear'],
    ['linear'],
    linearTools,
  ),
  entry(
    featureRequestIntake,
    'product',
    'Open a GitHub issue for a customer feature request.',
    'low',
    ['feature', 'github'],
    ['github'],
    githubTools,
  ),
  entry(
    internalActionWebhook,
    'admin',
    'Invoke a workspace-owned HTTP action through the generic webhook MCP.',
    'medium',
    ['webhook', 'admin'],
    ['webhook'],
    webhookTools,
  ),
  entry(
    twilioVerifyChannel,
    'account',
    'Send a Twilio Verify SMS OTP for phone-channel identity proof.',
    'medium',
    ['identity', 'otp', 'sms'],
    ['twilio-verify'],
    twilioVerifyTools,
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
