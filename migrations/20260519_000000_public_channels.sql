-- Phase 9 channels: hosted chat widget, hosted forms, plus every async
-- third-party surface (Slack, SMS, Discord, Telegram, WhatsApp) behind one
-- adapter contract. Adapter config is opaque JSON so adding a new channel
-- does not require a schema migration.

CREATE TABLE IF NOT EXISTS public_channel (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  require_email INTEGER NOT NULL DEFAULT 1,
  allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  welcome_message TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ciphertext TEXT,
  signing_secret TEXT,
  sla_first_response_minutes INTEGER,
  sla_resolution_minutes INTEGER,
  default_priority TEXT,
  default_assignee_user_id TEXT,
  last_event_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailbox(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_channel_workspace
  ON public_channel(workspace_id, kind, updated_at DESC);

-- Session-based public surfaces (chat widget, hosted form). Third-party
-- channels (Slack/SMS/Discord/Telegram/WhatsApp) do NOT use this table —
-- their threads live on message_index.rfc_message_id with a kind-prefixed
-- thread id.
CREATE TABLE IF NOT EXISTS public_conversation_session (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  visitor_id TEXT,
  origin TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES public_channel(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_session_channel
  ON public_conversation_session(workspace_id, channel_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_session_ticket
  ON public_conversation_session(workspace_id, ticket_id);

-- Cross-channel customer identity. One customer can have many
-- (channel_kind, external_id) pairs — same person, different surfaces.
CREATE TABLE IF NOT EXISTS customer (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  display_name TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_customer_workspace_email
  ON customer(workspace_id, primary_email) WHERE primary_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_workspace_phone
  ON customer(workspace_id, primary_phone) WHERE primary_phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_identity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  channel_kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, channel_kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_identity_customer
  ON channel_identity(workspace_id, customer_id);

-- Outbound dispatch tracking. One row per outbound message routed through
-- a third-party adapter; carries the provider result + retry state. Email
-- replies are owned by src/agents/supervisor/replies.ts and do not land here.
CREATE TABLE IF NOT EXISTS channel_outbound_dispatch (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  channel_kind TEXT NOT NULL,
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_channel_dispatch_ticket
  ON channel_outbound_dispatch(workspace_id, ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_dispatch_status
  ON channel_outbound_dispatch(workspace_id, status, updated_at) WHERE status = 'pending';

-- Tickets get an explicit origin channel so the outbound dispatcher knows
-- which adapter to use. Email tickets stay origin_channel_kind = 'email'
-- with no channel_id (they live on mailbox).
ALTER TABLE ticket ADD COLUMN origin_channel_kind TEXT NOT NULL DEFAULT 'email';
ALTER TABLE ticket ADD COLUMN origin_channel_id TEXT;
ALTER TABLE ticket ADD COLUMN customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ticket_customer
  ON ticket(workspace_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_origin_channel
  ON ticket(workspace_id, origin_channel_id) WHERE origin_channel_id IS NOT NULL;
