-- Phase 3 autonomous resolution, outcome telemetry, and feedback hooks.

ALTER TABLE mailbox ADD COLUMN autonomy_policy TEXT NOT NULL DEFAULT 'draft_only';
ALTER TABLE mailbox ADD COLUMN autonomy_threshold REAL NOT NULL DEFAULT 0.85;
ALTER TABLE mailbox ADD COLUMN autonomy_rollout_percent INTEGER NOT NULL DEFAULT 100;

UPDATE mailbox
   SET autonomy_policy = CASE auto_reply_policy
     WHEN 'always' THEN 'auto_send_always'
     WHEN 'safe' THEN 'auto_send_if_confident'
     ELSE 'draft_only'
   END;

CREATE TABLE IF NOT EXISTS ticket_outcome_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'resolved_autonomously',
    'resolved_via_procedure',
    'escalated',
    'customer_followed_up'
  )),
  source TEXT NOT NULL CHECK(source IN ('agent','procedure','system','user')),
  confidence_score REAL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ticket_outcome_workspace
  ON ticket_outcome_event(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_outcome_ticket
  ON ticket_outcome_event(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  message_id TEXT,
  rating TEXT NOT NULL CHECK(rating IN ('positive','negative')),
  source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN ('agent','customer','system')),
  comment TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ticket_feedback_workspace
  ON ticket_feedback(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_feedback_ticket
  ON ticket_feedback(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_outcome_daily (
  workspace_id TEXT NOT NULL,
  day TEXT NOT NULL,
  resolved_autonomously_count INTEGER NOT NULL DEFAULT 0,
  resolved_via_procedure_count INTEGER NOT NULL DEFAULT 0,
  escalated_count INTEGER NOT NULL DEFAULT 0,
  customer_followed_up_count INTEGER NOT NULL DEFAULT 0,
  positive_feedback_count INTEGER NOT NULL DEFAULT 0,
  negative_feedback_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, day),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_outcome_daily_workspace
  ON workspace_outcome_daily(workspace_id, day DESC);
