-- Phase 6 historical evals.

CREATE TABLE IF NOT EXISTS eval_case (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('resolved_ticket','procedure_spec','synthetic','api')),
  ticket_id TEXT,
  procedure_id TEXT,
  procedure_version_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  input_json TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  anonymization_json TEXT NOT NULL DEFAULT '{}',
  source_fingerprint TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, source, source_fingerprint),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE SET NULL,
  FOREIGN KEY (procedure_id) REFERENCES procedure(id) ON DELETE SET NULL,
  FOREIGN KEY (procedure_version_id) REFERENCES procedure_version(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_case_workspace
  ON eval_case(workspace_id, status, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_case_ticket
  ON eval_case(workspace_id, ticket_id);

CREATE TABLE IF NOT EXISTS eval_run (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'api' CHECK(source IN ('api','cli','ci','scheduled')),
  status TEXT NOT NULL CHECK(status IN ('running','passed','failed')),
  case_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  regression_count INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_run_workspace
  ON eval_run(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS eval_result (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('passed','failed','skipped')),
  score REAL,
  assertions_json TEXT NOT NULL DEFAULT '[]',
  actual_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES eval_run(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES eval_case(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_result_run
  ON eval_result(run_id, status);

CREATE INDEX IF NOT EXISTS idx_eval_result_case
  ON eval_result(workspace_id, case_id, created_at DESC);
