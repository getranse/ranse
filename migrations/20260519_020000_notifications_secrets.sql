-- Phase 9 final pass: secret encryption, customer channel preferences,
-- omnichannel notification cascade, retry/DLQ for outbound dispatch.

-- Secrets at rest. The migration adds the ciphertext column; the application
-- splits new writes into config_json (public) + secrets_ciphertext (sealed
-- with workspace-keyed AES-GCM). Existing rows keep their plaintext config
-- and continue to work — the read path merges both sources transparently.
ALTER TABLE public_channel ADD COLUMN secrets_ciphertext TEXT;

-- Retry plumbing on the dispatch row. The reaper job + queue consumer
-- update next_attempt_at and increment attempts; max_attempts caps the loop.
ALTER TABLE channel_outbound_dispatch ADD COLUMN next_attempt_at INTEGER;
ALTER TABLE channel_outbound_dispatch ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5;
CREATE INDEX IF NOT EXISTS idx_channel_dispatch_retry
  ON channel_outbound_dispatch(workspace_id, status, next_attempt_at)
  WHERE status = 'pending';

-- Per-customer per-channel preference. One row per (workspace, customer,
-- channel_kind). status='disabled' is a hard block; 'enabled' is the default.
-- quiet_hours_* are minute-of-day in the customer's timezone; the dispatcher
-- skips delivery during the window and rolls cascade plans forward.
CREATE TABLE IF NOT EXISTS customer_channel_preference (
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  channel_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  quiet_hours_start_minutes INTEGER,
  quiet_hours_end_minutes INTEGER,
  timezone TEXT,
  consent_source TEXT,
  consent_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, customer_id, channel_kind),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
);

-- Notification templates. Operator-defined message templates that the
-- cascade engine fills with payload and sends. Channel-specific bodies
-- live in bodies_json keyed by channel_kind (so the same template renders
-- short for SMS and long for email).
CREATE TABLE IF NOT EXISTS notification_template (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_channels_json TEXT NOT NULL DEFAULT '[]',
  bodies_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, slug)
);

-- A cascade plan — one per "deliver this notification to that customer".
-- The plan owns the global status; the individual channel attempts live in
-- notification_step rows.
CREATE TABLE IF NOT EXISTS notification_plan (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  ticket_id TEXT,
  template_id TEXT,
  template_slug TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  acknowledged_at INTEGER,
  completed_at INTEGER,
  cancelled_reason TEXT,
  created_by_user_id TEXT,
  source TEXT NOT NULL DEFAULT 'api',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE SET NULL,
  FOREIGN KEY (template_id) REFERENCES notification_template(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_plan_status
  ON notification_plan(workspace_id, status, updated_at)
  WHERE status IN ('pending','active');

-- Each cascade step is a single attempt over a single channel. The cascade
-- engine wakes the next pending step when:
--   - schedule_at <= now, AND
--   - the previous step (if any) reached its trigger_on condition.
-- trigger_on: 'immediate' | 'previous_failed' | 'previous_unread' |
-- 'previous_no_ack' | 'time_elapsed'.
CREATE TABLE IF NOT EXISTS notification_step (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  channel_kind TEXT NOT NULL,
  channel_id TEXT,
  trigger_on TEXT NOT NULL DEFAULT 'immediate',
  delay_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at INTEGER,
  attempted_at INTEGER,
  delivered_at INTEGER,
  read_at INTEGER,
  acknowledged_at INTEGER,
  external_id TEXT,
  last_error TEXT,
  body_text TEXT,
  body_html TEXT,
  body_json TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES notification_plan(id) ON DELETE CASCADE,
  UNIQUE (plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_notification_step_due
  ON notification_step(workspace_id, status, scheduled_at)
  WHERE status = 'pending';

-- Per-step delivery telemetry — sent, delivered, read, clicked, failed.
-- Receipts from providers (Twilio status callbacks, WhatsApp read receipts,
-- email click-tracking) land here; the cascade engine reads them to decide
-- whether to advance to the next step.
CREATE TABLE IF NOT EXISTS notification_delivery_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES notification_step(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_step
  ON notification_delivery_event(step_id, occurred_at DESC);
