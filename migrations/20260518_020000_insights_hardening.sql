-- Phase 8 insights hardening: suggestion confidence and acceptance lineage.

ALTER TABLE kb_suggestion ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kb_suggestion ADD COLUMN confidence_score REAL NOT NULL DEFAULT 0;
ALTER TABLE kb_suggestion ADD COLUMN accepted_source_id TEXT;
ALTER TABLE kb_suggestion ADD COLUMN accepted_by_user_id TEXT;
ALTER TABLE kb_suggestion ADD COLUMN accepted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_kb_suggestion_acceptance
  ON kb_suggestion(workspace_id, status, accepted_at DESC);
