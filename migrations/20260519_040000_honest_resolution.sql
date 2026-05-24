-- Honest Resolution metric. A verified_resolution row is created when an AI
-- (autonomous or procedure) reply lands on a ticket and is marked verified only
-- after a 7-day quiet window with no human takeover, escalation, customer
-- follow-up, or negative feedback. The point is to publish a customer-confirmed
-- resolution rate alongside the industry-standard "first-response-with-no-reply"
-- number, which is the metric Fin and others quietly inflate.
--
-- One row per ticket; the unique constraint ensures a single source of truth
-- per ticket lifecycle. A ticket that re-opens after a verified resolution
-- gets a fresh row only after another AI message lands.

CREATE TABLE IF NOT EXISTS verified_resolution (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  ai_message_id TEXT NOT NULL,
  ai_authored_at INTEGER NOT NULL,
  window_closes_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  verified_at INTEGER,
  source TEXT NOT NULL DEFAULT 'autonomous',
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_verified_resolution_sweep
  ON verified_resolution(status, window_closes_at);
CREATE INDEX IF NOT EXISTS idx_verified_resolution_workspace
  ON verified_resolution(workspace_id, status, ai_authored_at);
