-- Delivery-failure suppression list. Hard bounces (5.x.x) suppress AI
-- auto-send to the address immediately; soft bounces (4.x.x) suppress after
-- repeated failures. Human operators can still send explicitly.
CREATE TABLE email_suppression (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  address TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'soft_bounce')),
  status_code TEXT,
  ticket_id TEXT,
  bounce_count INTEGER NOT NULL DEFAULT 1,
  last_bounce_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, address)
);

CREATE INDEX idx_email_suppression_lookup ON email_suppression (workspace_id, address);
