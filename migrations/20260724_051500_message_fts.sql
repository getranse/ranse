-- Full-text search over ticket messages. FTS5 indexes each message's subject
-- + preview; ticket search groups matches by ticket. Kept in sync by trigger
-- so application code never writes the index directly.
CREATE VIRTUAL TABLE message_fts USING fts5(
  content,
  message_id UNINDEXED,
  ticket_id UNINDEXED,
  workspace_id UNINDEXED
);

CREATE TRIGGER message_index_fts_ai AFTER INSERT ON message_index BEGIN
  INSERT INTO message_fts (content, message_id, ticket_id, workspace_id)
  VALUES (
    COALESCE(NEW.subject, '') || ' ' || COALESCE(NEW.preview, ''),
    NEW.id,
    NEW.ticket_id,
    NEW.workspace_id
  );
END;

-- Backfill existing messages.
INSERT INTO message_fts (content, message_id, ticket_id, workspace_id)
SELECT COALESCE(subject, '') || ' ' || COALESCE(preview, ''), id, ticket_id, workspace_id
FROM message_index;
