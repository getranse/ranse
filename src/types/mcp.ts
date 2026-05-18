export type McpAuthType = 'none' | 'bearer' | 'header';
export type McpToolCallStatus = 'pending_approval' | 'running' | 'completed' | 'failed' | 'blocked';

export interface McpServer {
  id: string;
  workspace_id: string;
  name: string;
  endpoint_url: string;
  auth_type: McpAuthType;
  auth_header_name: string | null;
  secret_ref: string | null;
  enabled: number;
  last_discovered_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface McpServerListItem extends McpServer {
  tool_count: number;
}

export interface McpTool {
  id: string;
  workspace_id: string;
  server_id: string;
  name: string;
  title: string | null;
  description: string | null;
  input_schema_json: string;
  annotations_json: string;
  read_only_hint: number | null;
  destructive_hint: number | null;
  discovered_at: number;
  server_name?: string;
  server_enabled?: number;
  guardrail_enabled?: number | null;
  guardrail_requires_approval?: number | null;
  guardrail_max_calls_per_ticket?: number | null;
  guardrail_max_calls_per_hour?: number | null;
  guardrail_dollar_limit_cents?: number | null;
}

export interface McpToolGuardrail {
  workspace_id: string;
  server_id: string;
  tool_name: string;
  enabled: number;
  requires_approval: number | null;
  max_calls_per_ticket: number | null;
  max_calls_per_hour: number | null;
  dollar_limit_cents: number | null;
  allowed_customer_segments_json: string;
  updated_at: number;
}

export interface EffectiveMcpToolGuardrail {
  enabled: boolean;
  requires_approval: boolean;
  max_calls_per_ticket: number | null;
  max_calls_per_hour: number | null;
  dollar_limit_cents: number | null;
  allowed_customer_segments: string[];
}

export interface McpToolCall {
  id: string;
  workspace_id: string;
  server_id: string;
  tool_name: string;
  ticket_id: string;
  procedure_run_id: string | null;
  procedure_step_id: string | null;
  procedure_step_index: number | null;
  status: McpToolCallStatus;
  args_json: string;
  result_json: string;
  error: string | null;
  approval_request_id: string | null;
  idempotency_key: string;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  server_name?: string;
}

export interface McpDiscoveredTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
