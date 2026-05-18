-- Phase 8 insights and auto-improving knowledge base.

CREATE TABLE IF NOT EXISTS conversation_score (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  groundedness_score REAL NOT NULL CHECK(groundedness_score >= 0 AND groundedness_score <= 1),
  tone_score REAL NOT NULL CHECK(tone_score >= 0 AND tone_score <= 1),
  resolution_score REAL NOT NULL CHECK(resolution_score >= 0 AND resolution_score <= 1),
  effort_score REAL NOT NULL CHECK(effort_score >= 0 AND effort_score <= 1),
  overall_score REAL NOT NULL CHECK(overall_score >= 0 AND overall_score <= 1),
  signals_json TEXT NOT NULL DEFAULT '{}',
  scored_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, ticket_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_score_workspace
  ON conversation_score(workspace_id, overall_score ASC, scored_at DESC);

CREATE TABLE IF NOT EXISTS kb_suggestion (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  source_ticket_ids_json TEXT NOT NULL DEFAULT '[]',
  suggested_terms_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','dismissed')),
  source TEXT NOT NULL DEFAULT 'unresolved_cluster',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, cluster_key),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kb_suggestion_workspace
  ON kb_suggestion(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_drift_signal (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  signal_hash TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  successful_reply_count INTEGER NOT NULL DEFAULT 0,
  divergence_terms_json TEXT NOT NULL DEFAULT '[]',
  example_ticket_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  detected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, source_id, signal_hash),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES knowledge_source(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_drift_signal_workspace
  ON knowledge_drift_signal(workspace_id, status, severity, detected_at DESC);
