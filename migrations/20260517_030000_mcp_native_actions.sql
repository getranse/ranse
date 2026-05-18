-- Phase 5 MCP-native actions.

CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK(auth_type IN ('none','bearer','header')),
  auth_header_name TEXT,
  secret_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_discovered_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_workspace
  ON mcp_server(workspace_id, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS mcp_tool (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  description TEXT,
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  annotations_json TEXT NOT NULL DEFAULT '{}',
  read_only_hint INTEGER,
  destructive_hint INTEGER,
  discovered_at INTEGER NOT NULL,
  UNIQUE(server_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_server(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_workspace
  ON mcp_tool(workspace_id, name);

CREATE TABLE IF NOT EXISTS mcp_tool_guardrail (
  workspace_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER,
  max_calls_per_ticket INTEGER,
  max_calls_per_hour INTEGER,
  dollar_limit_cents INTEGER,
  allowed_customer_segments_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, server_id, tool_name),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_server(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_tool_call (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  procedure_run_id TEXT,
  procedure_step_id TEXT,
  procedure_step_index INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending_approval','running','completed','failed','blocked')),
  args_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  approval_request_id TEXT,
  idempotency_key TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_server(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE,
  FOREIGN KEY (procedure_run_id) REFERENCES procedure_run(id) ON DELETE SET NULL,
  FOREIGN KEY (approval_request_id) REFERENCES approval_request(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_call_ticket
  ON mcp_tool_call(workspace_id, ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_call_rate
  ON mcp_tool_call(workspace_id, server_id, tool_name, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tool_call_procedure_step
  ON mcp_tool_call(workspace_id, procedure_run_id, procedure_step_index)
  WHERE procedure_run_id IS NOT NULL AND procedure_step_index IS NOT NULL;
