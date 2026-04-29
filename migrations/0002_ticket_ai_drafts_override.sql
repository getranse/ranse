-- Migration number: 0002 	 2026-04-29T06:28:11.938Z

-- Per-ticket override for the workspace-level ai_drafts setting.
-- NULL = inherit workspace; 0 = off for this ticket; 1 = on for this ticket.
ALTER TABLE ticket ADD COLUMN ai_drafts_enabled INTEGER;
