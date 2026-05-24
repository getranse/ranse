-- Outcome-based pricing instrument. The point isn't to charge customers — most
-- ranse workspaces self-host on their own Cloudflare account and pay their own
-- inference bill. The instrument exists so a buyer can ask "what would this
-- have cost on Fin's $0.99 / outcome model?" against the same workspace data,
-- and so a future hosted SaaS can drive invoicing from real telemetry instead
-- of inflated resolution counts.
--
-- One row per workspace; the config JSON holds the price book so we can extend
-- the outcome kinds without a migration. The ledger entries are signed money
-- amounts so a single column carries both value and cost.

CREATE TABLE IF NOT EXISTS workspace_outcome_pricing (
  workspace_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  inference_cost_cents_per_1k_tokens INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outcome_ledger_entry (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  outcome_event_id TEXT,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outcome_ledger_workspace
  ON outcome_ledger_entry(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outcome_ledger_ticket
  ON outcome_ledger_entry(workspace_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_outcome_ledger_event
  ON outcome_ledger_entry(workspace_id, outcome_event_id);
