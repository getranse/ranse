-- Proactive resolution loop. The capstone of Phase 11. The Phase 8 insights
-- system already detects unresolved-intent clusters and KB drift. The
-- proactive loop closes it: cluster → LLM-drafted procedure + KB entry → run
-- eval against historical cases → operator one-click approve → publish.
--
-- The proposal queue is the audit surface: every proposal carries its draft
-- spec, eval pass rate, and applied-procedure-id if accepted. Operators can
-- reject with a reason, and the system can auto-reject when eval pass rate
-- falls below threshold — never silently publishing AI-drafted changes.

CREATE TABLE IF NOT EXISTS proactive_proposal (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('procedure','knowledge','combined')),
  draft_procedure_spec_json TEXT,
  draft_knowledge_entry_json TEXT,
  eval_pass_rate REAL,
  eval_case_count INTEGER NOT NULL DEFAULT 0,
  eval_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','rejected','auto_rejected')),
  rejected_reason TEXT,
  proposed_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  applied_procedure_id TEXT,
  applied_knowledge_source_id TEXT,
  summary TEXT,
  evidence_ticket_ids_json TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, cluster_key)
);

CREATE INDEX IF NOT EXISTS idx_proactive_proposal_workspace
  ON proactive_proposal(workspace_id, status, proposed_at DESC);
