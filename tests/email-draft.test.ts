import { describe, expect, it } from 'vitest';
import { hasExistingResponseForSourceMessage } from '../src/server/inbox/agents/supervisor/email-draft';
import { createWorkspaceTestDb, seedMailbox, seedWorkspace } from './helpers/workspace-db';

function seedTicket(db: ReturnType<typeof createWorkspaceTestDb>['db']) {
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO ticket (
      id, workspace_id, mailbox_id, subject, last_message_at, requester_email,
      thread_token, created_at, updated_at
    ) VALUES ('tkt_1', 'ws_a', 'mb_a', 'Refund', 1, 'a@example.com', 'tok', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO message_index (
      id, ticket_id, workspace_id, direction, rfc_message_id, sent_at, created_at
    ) VALUES ('msg_in', 'tkt_1', 'ws_a', 'inbound', '<in@example.com>', 1, 1)`,
  ).run();
}

describe('scheduled draft idempotency', () => {
  it('detects an already-created approval for the inbound message', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedTicket(db);
    db.prepare(
      `INSERT INTO approval_request (
        id, workspace_id, ticket_id, kind, status, proposed_json, created_at
      ) VALUES ('apr_1', 'ws_a', 'tkt_1', 'send_reply', 'pending', ?, 2)`,
    ).run(JSON.stringify({ source_message_id: 'msg_in' }));

    await expect(hasExistingResponseForSourceMessage(
      env as any,
      'ws_a',
      'tkt_1',
      'msg_in',
    )).resolves.toBe(true);
  });

  it('detects an already-sent threaded reply for the inbound message', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedTicket(db);
    db.prepare(
      `INSERT INTO message_index (
        id, ticket_id, workspace_id, direction, rfc_message_id, in_reply_to, sent_at, created_at
      ) VALUES ('msg_out', 'tkt_1', 'ws_a', 'outbound', '<out@example.com>', '<in@example.com>', 2, 2)`,
    ).run();

    await expect(hasExistingResponseForSourceMessage(
      env as any,
      'ws_a',
      'tkt_1',
      'msg_in',
    )).resolves.toBe(true);
  });
});
