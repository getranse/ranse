export interface FirstPartyMcpTemplate {
  id: string;
  name: string;
  label: string;
  description: string;
  expectedTools: string[];
  authType: 'bearer' | 'header';
  authHeaderName?: string;
  endpointPlaceholder: string;
}

export const FIRST_PARTY_MCP_TEMPLATES: FirstPartyMcpTemplate[] = [
  {
    id: 'stripe',
    name: 'stripe',
    label: 'Stripe',
    description: 'Billing lookup and refund actions exposed through a Stripe MCP server.',
    expectedTools: ['customers.search', 'subscriptions.retrieve', 'refunds.create'],
    authType: 'bearer',
    endpointPlaceholder: 'https://your-stripe-mcp.example.com/mcp',
  },
  {
    id: 'shopify',
    name: 'shopify',
    label: 'Shopify',
    description: 'Order lookup, fulfillment status, and return workflow actions.',
    expectedTools: ['orders.search', 'orders.retrieve', 'returns.create'],
    authType: 'bearer',
    endpointPlaceholder: 'https://your-shopify-mcp.example.com/mcp',
  },
  {
    id: 'github',
    name: 'github',
    label: 'GitHub',
    description: 'Repository issue, pull request, and escalation actions through MCP.',
    expectedTools: ['issues.create', 'issues.comment', 'pull_requests.get'],
    authType: 'bearer',
    endpointPlaceholder: 'https://your-github-mcp.example.com/mcp',
  },
  {
    id: 'linear',
    name: 'linear',
    label: 'Linear',
    description: 'Support escalations mapped to Linear issues and team workflows.',
    expectedTools: ['issues.create', 'issues.update', 'teams.list'],
    authType: 'bearer',
    endpointPlaceholder: 'https://your-linear-mcp.example.com/mcp',
  },
  {
    id: 'generic-webhook',
    name: 'webhook',
    label: 'Generic webhook',
    description: 'A minimal MCP facade for internal HTTP actions owned by the workspace.',
    expectedTools: ['webhook.call'],
    authType: 'header',
    authHeaderName: 'x-ranse-webhook-secret',
    endpointPlaceholder: 'https://your-webhook-mcp.example.com/mcp',
  },
];
