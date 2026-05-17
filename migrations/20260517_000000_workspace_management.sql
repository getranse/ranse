-- Phase 1.5 workspace management and tenant isolation.

ALTER TABLE workspace ADD COLUMN updated_at INTEGER;
ALTER TABLE workspace ADD COLUMN archived_at INTEGER;
ALTER TABLE workspace ADD COLUMN deleted_at INTEGER;

UPDATE workspace SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_active
  ON workspace(deleted_at, archived_at, created_at);

CREATE TABLE IF NOT EXISTS workspace_invitation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','agent','viewer')),
  token TEXT NOT NULL UNIQUE,
  accepted_at INTEGER,
  expires_at INTEGER NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitation_workspace
  ON workspace_invitation(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_invitation_email
  ON workspace_invitation(email, accepted_at, expires_at);
