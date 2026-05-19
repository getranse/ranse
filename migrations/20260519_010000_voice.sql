-- Phase 9 voice. Calls are first-class: one `voice_call` row per phone call
-- (or browser session), with each utterance and reply persisted as a
-- `voice_call_turn`. The same turns also land in `message_index` so the
-- existing reply/procedure pipeline sees voice tickets the same way it
-- sees email or SMS tickets — just with audio attachments.

CREATE TABLE IF NOT EXISTS voice_call (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  customer_id TEXT,
  provider TEXT NOT NULL,
  external_call_id TEXT NOT NULL,
  caller_number TEXT,
  callee_number TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'ringing',
  agent_mode TEXT NOT NULL DEFAULT 'autonomous',
  started_at INTEGER NOT NULL,
  connected_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER,
  recording_r2_key TEXT,
  transcript_r2_key TEXT,
  summary TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES public_channel(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL,
  UNIQUE(workspace_id, channel_id, external_call_id)
);
CREATE INDEX IF NOT EXISTS idx_voice_call_ticket
  ON voice_call(workspace_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_voice_call_channel
  ON voice_call(workspace_id, channel_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_call_status
  ON voice_call(workspace_id, status, updated_at DESC) WHERE status IN ('ringing','connected');

CREATE TABLE IF NOT EXISTS voice_call_turn (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  message_id TEXT,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT,
  audio_r2_key TEXT,
  duration_ms INTEGER,
  model TEXT,
  confidence REAL,
  interrupted INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (call_id) REFERENCES voice_call(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE,
  UNIQUE(call_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_voice_turn_call
  ON voice_call_turn(call_id, sequence);

-- Raw provider events kept for replay + debugging. Bounded by a periodic
-- cleanup job (insights maintenance is already wired weekly).
CREATE TABLE IF NOT EXISTS voice_provider_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  call_id TEXT,
  channel_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_r2_key TEXT,
  received_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES public_channel(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_voice_event_channel
  ON voice_provider_event(workspace_id, channel_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_event_call
  ON voice_provider_event(call_id, received_at) WHERE call_id IS NOT NULL;
