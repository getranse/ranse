-- Ranse v1 schema

CREATE TABLE IF NOT EXISTS setup_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS workspace_user (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','agent','viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mailbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  display_name TEXT,
  reply_signing_secret TEXT NOT NULL,
  auto_reply_policy TEXT NOT NULL DEFAULT 'safe',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mailbox_workspace ON mailbox(workspace_id);

CREATE TABLE IF NOT EXISTS ticket (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','resolved','closed','spam')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  category TEXT,
  sentiment TEXT,
  assignee_user_id TEXT,
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  first_message_id TEXT,
  last_message_at INTEGER NOT NULL,
  thread_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailbox(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ticket_workspace_status ON ticket(workspace_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_assignee ON ticket(assignee_user_id) WHERE assignee_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_requester ON ticket(workspace_id, requester_email);

CREATE TABLE IF NOT EXISTS message_index (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','note')),
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  preview TEXT,
  raw_r2_key TEXT,
  body_r2_key TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  author_user_id TEXT,
  sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_ticket ON message_index(ticket_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_message_rfc ON message_index(rfc_message_id) WHERE rfc_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','agent','system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_event(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_event(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_request (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
  proposed_json TEXT NOT NULL,
  risk_reasons_json TEXT NOT NULL DEFAULT '[]',
  decided_by_user_id TEXT,
  decided_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_approval_workspace_status ON approval_request(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS macro (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_doc (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_workspace ON knowledge_doc(workspace_id);

CREATE TABLE IF NOT EXISTS webhook_subscription (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

CREATE TABLE IF NOT EXISTS workspace_llm_config (
  workspace_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  fallback_model TEXT,
  reasoning_effort TEXT,
  temperature REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, action_key),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
