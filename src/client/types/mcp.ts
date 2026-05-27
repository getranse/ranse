import type { McpServerListItem, McpTool } from '../../types/mcp';

export type McpServerEntry = McpServerListItem;
export type McpToolEntry = McpTool;

export interface McpCatalogTemplate {
  id: string;
  name: string;
  label: string;
  description: string;
  expectedTools: string[];
  authType: 'bearer' | 'header';
  authHeaderName?: string;
  endpointPlaceholder: string;
}

export interface McpServerInput {
  name: string;
  endpoint_url: string;
  auth_type: 'none' | 'bearer' | 'header';
  auth_header_name?: string | null;
  auth_secret?: string;
  enabled?: boolean;
}

export interface McpGuardrailInput {
  tool_name: string;
  enabled?: boolean;
  requires_approval?: boolean | null;
  max_calls_per_ticket?: number | null;
  max_calls_per_hour?: number | null;
  dollar_limit_cents?: number | null;
  allowed_customer_segments?: string[];
}
