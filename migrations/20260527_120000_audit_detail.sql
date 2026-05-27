-- Detailed audit trail: request context, actor identity snapshot, taxonomy, and
-- a tamper-evident hash chain. All columns are additive/nullable so existing
-- rows remain valid; category/severity default to the catalog's "general/info".
ALTER TABLE audit_event ADD COLUMN ip TEXT;
ALTER TABLE audit_event ADD COLUMN user_agent TEXT;
ALTER TABLE audit_event ADD COLUMN request_id TEXT;
ALTER TABLE audit_event ADD COLUMN actor_email TEXT;
ALTER TABLE audit_event ADD COLUMN actor_name TEXT;
ALTER TABLE audit_event ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE audit_event ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE audit_event ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_event ADD COLUMN hash TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_event(workspace_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_event(workspace_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_event(workspace_id, actor_id, created_at DESC);
