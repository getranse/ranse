-- Migration number: 20260513_000000 	 2026-05-13T00:00:00.000Z

-- Phase 1 retrieval foundations. `knowledge_doc` remains for backward
-- compatibility with early installs; new code reads and writes sources/chunks.
CREATE TABLE IF NOT EXISTS knowledge_source (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('manual','url','pdf','resolved_ticket')),
  title TEXT NOT NULL,
  url TEXT,
  r2_key TEXT,
  ticket_id TEXT,
  message_id TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','indexing','ready','failed')),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  last_crawled_at INTEGER,
  last_indexed_at INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_source_workspace
  ON knowledge_source(workspace_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source_url
  ON knowledge_source(workspace_id, kind, url)
  WHERE url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source_message
  ON knowledge_source(workspace_id, kind, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_source_content_hash
  ON knowledge_source(workspace_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_chunk (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  snippet TEXT NOT NULL,
  url TEXT,
  vector_id TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  used_in_answers_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES knowledge_source(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_workspace
  ON knowledge_chunk(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_source
  ON knowledge_chunk(source_id, ordinal);

-- Copy legacy manual docs into the source/chunk model. These rows are marked
-- ready so keyword retrieval keeps working immediately; last_indexed_at stays
-- NULL until a user refreshes the source and creates Vectorize embeddings.
INSERT OR IGNORE INTO knowledge_source (
  id, workspace_id, kind, title, url, status, chunk_count, created_at, updated_at
)
SELECT id, workspace_id, 'manual', title, url, 'ready', 1, created_at, updated_at
FROM knowledge_doc;

INSERT OR IGNORE INTO knowledge_chunk (
  id, workspace_id, source_id, ordinal, title, body, snippet, url, vector_id, content_hash, created_at, updated_at
)
SELECT
  id || ':0',
  workspace_id,
  id,
  0,
  title,
  body,
  substr(body, 1, 500),
  url,
  id || ':0',
  lower(hex(randomblob(16))),
  created_at,
  updated_at
FROM knowledge_doc;
