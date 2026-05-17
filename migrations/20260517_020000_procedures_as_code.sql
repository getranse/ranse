-- Phase 4 procedures as code.

CREATE TABLE IF NOT EXISTS procedure (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK(trigger_type IN ('manual','ticket_created','intent')),
  trigger_category TEXT,
  trigger_intent TEXT,
  active_version_id TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, slug),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_procedure_workspace
  ON procedure(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_procedure_trigger
  ON procedure(workspace_id, trigger_type, trigger_category, trigger_intent)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS procedure_version (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  procedure_id TEXT NOT NULL,
  version TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'api' CHECK(source_kind IN ('api','git','seed')),
  source_ref TEXT,
  checksum TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(procedure_id, version),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (procedure_id) REFERENCES procedure(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_procedure_version_workspace
  ON procedure_version(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS procedure_run (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  procedure_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  trigger_event_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','completed','failed','cancelled')),
  current_step INTEGER NOT NULL DEFAULT 0,
  context_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (procedure_id) REFERENCES procedure(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES procedure_version(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, procedure_id, ticket_id, trigger_event_key)
);

CREATE INDEX IF NOT EXISTS idx_procedure_run_workspace
  ON procedure_run(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_procedure_run_ticket
  ON procedure_run(workspace_id, ticket_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS procedure_step_run (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','waiting','completed','failed','skipped')),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES procedure_run(id) ON DELETE CASCADE,
  UNIQUE(run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_step_run_run
  ON procedure_step_run(run_id, step_index);
