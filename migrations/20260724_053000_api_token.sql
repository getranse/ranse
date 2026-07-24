-- Workspace-scoped API tokens for programmatic access. Only the SHA-256 hash
-- is stored; the raw token is shown once at creation. Role bounds what the
-- token can do (same enforcement as session roles).
CREATE TABLE api_token (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'viewer')),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_api_token_workspace ON api_token (workspace_id);
