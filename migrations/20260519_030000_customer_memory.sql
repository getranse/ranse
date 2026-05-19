-- Long-term customer memory. After a ticket resolves, an extractor reads
-- the conversation and persists durable facts about the customer (account
-- type, preferences, prior complaints, time zone, name pronunciation, …).
-- New tickets from the same customer see those facts in their procedure
-- context, so the agent can pick up where the last conversation left off.
--
-- Memory is conservative on purpose: facts must be tied to an evidence
-- ticket/message, carry a confidence score, and can be operator-redacted
-- (sets redacted_at, keeps the row for audit). High-impact, low-volume
-- table — designed to never grow past a few KB per customer.

CREATE TABLE IF NOT EXISTS customer_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  fact_text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  source_ticket_id TEXT,
  source_message_id TEXT,
  evidence_hash TEXT,
  created_by TEXT NOT NULL DEFAULT 'extractor',
  redacted_at INTEGER,
  redacted_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE,
  FOREIGN KEY (source_ticket_id) REFERENCES ticket(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, customer_id, evidence_hash)
);
CREATE INDEX IF NOT EXISTS idx_customer_memory_lookup
  ON customer_memory(workspace_id, customer_id, redacted_at)
  WHERE redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_memory_ticket
  ON customer_memory(workspace_id, source_ticket_id);
