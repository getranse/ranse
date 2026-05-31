import { describe, expect, it } from 'vitest';
import { ingestEmail } from '../src/server/inbox/agents/supervisor/email-flow';
import {
  createWorkspaceTestDb,
  seedMailbox,
  seedWorkspace,
} from './helpers/workspace-db';

describe('email ingest follow-up detection', () => {
  it('reopens resolved tickets and records a customer follow-up outcome', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com', 'secret');
    db.prepare(
      `INSERT INTO ticket (
        id, workspace_id, mailbox_id, subject, status, last_message_at, requester_email,
        thread_token, created_at, updated_at
      ) VALUES ('tkt_1', 'ws_a', 'mb_a', 'Refund', 'resolved', 1, 'a@example.com', 'tok', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO message_index (
        id, ticket_id, workspace_id, direction, rfc_message_id, sent_at, created_at
      ) VALUES ('msg_1', 'tkt_1', 'ws_a', 'inbound', '<first@example.com>', 1, 1)`,
    ).run();

    const result = await ingestEmail({
      env: env as any,
      workspaceId: 'ws_a',
      schedule: async () => undefined,
      refreshCounts: async () => undefined,
      aiDraftsEnabled: async () => false,
    }, {
      mailboxId: 'mb_a',
      mailboxAddress: 'support@example.com',
      replySigningSecret: 'secret',
      from: { address: 'a@example.com' },
      to: ['support@example.com'],
      cc: [],
      subject: 'Re: Refund',
      text: 'Any update?',
      messageId: '<follow@example.com>',
      inReplyTo: '<first@example.com>',
      references: ['<first@example.com>'],
      isAutoReply: false,
      rawKey: 'raw/email',
      receivedAt: 2,
      attachmentCount: 0,
    });

    expect(result.ticketId).toBe('tkt_1');
    expect(db.prepare(`SELECT status FROM ticket WHERE id = 'tkt_1'`).get()).toEqual({ status: 'open' });
    expect(db.prepare(`SELECT kind FROM ticket_outcome_event WHERE ticket_id = 'tkt_1'`).get())
      .toEqual({ kind: 'customer_followed_up' });
  });
});
