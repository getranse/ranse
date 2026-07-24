-- Operator-defined tags. Names are unique per workspace; assignments are
-- deduped by the composite primary key.
CREATE TABLE tag (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE ticket_tag (
  ticket_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, tag_id)
);

CREATE INDEX idx_ticket_tag_by_tag ON ticket_tag (workspace_id, tag_id);
