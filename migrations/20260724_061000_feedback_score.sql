-- Survey CSAT: customers can follow the thumbs click with a 1–5 score and an
-- optional comment on the same signed feedback link.
ALTER TABLE ticket_feedback ADD COLUMN score INTEGER;
