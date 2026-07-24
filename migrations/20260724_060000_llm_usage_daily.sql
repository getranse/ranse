-- Per-workspace daily LLM call counter. Backs the optional spend guard:
-- workspaces can set settings.llm_daily_call_budget to cap inference calls
-- per UTC day (0/unset = unlimited).
CREATE TABLE llm_usage_daily (
  workspace_id TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, day)
);
