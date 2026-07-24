-- Teams for shared inbox ownership and auto-assignment. A mailbox may name a
-- default team; new tickets on that mailbox are round-robin assigned to the
-- team member carrying the fewest open tickets.
CREATE TABLE team (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE team_member (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE ticket ADD COLUMN team_id TEXT;
ALTER TABLE mailbox ADD COLUMN default_team_id TEXT;

CREATE INDEX idx_ticket_team ON ticket (workspace_id, team_id);
