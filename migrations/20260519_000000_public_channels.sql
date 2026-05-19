-- Phase 9 public web channels: embeddable chat and hosted support forms.

CREATE TABLE IF NOT EXISTS public_channel (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chat','form')),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  require_email INTEGER NOT NULL DEFAULT 1,
  allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  welcome_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailbox(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_channel_workspace
  ON public_channel(workspace_id, kind, updated_at DESC);

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
