-- Knowledge staleness signal. Real-world reviews of Fin found that stale KB
-- silently kills resolution rate ("Fin gave a technically correct answer to
-- the wrong question, or pulled from an article that was accurate six months
-- ago"). Ranse already has drift detection in src/insights/; this turns
-- staleness into a first-class retrieval signal that down-ranks stale chunks
-- and exposes a Knowledge Health Score on the operations dashboard.
--
-- The score is computed by the weekly maintenance job from:
--   1. age since last_crawled_at (slow exponential decay)
--   2. drift signal: cited but in low-CSAT replies
--   3. operator override: explicit mark_stale action
--
-- We attach staleness to knowledge_source (the parent), with an optional
-- chunk-level override for cases where one section of a page is stale but
-- the rest still resolves correctly.

ALTER TABLE knowledge_source ADD COLUMN staleness_score REAL NOT NULL DEFAULT 0;
ALTER TABLE knowledge_source ADD COLUMN staleness_components_json TEXT;
ALTER TABLE knowledge_source ADD COLUMN staleness_updated_at INTEGER;
ALTER TABLE knowledge_source ADD COLUMN staleness_marked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_source_staleness
  ON knowledge_source(workspace_id, staleness_score);

CREATE TABLE IF NOT EXISTS knowledge_chunk_staleness (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  staleness_score REAL NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, chunk_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES knowledge_source(id) ON DELETE CASCADE
);
