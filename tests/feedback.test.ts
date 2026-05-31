import { describe, expect, it } from 'vitest';
import { recordFeedback } from '../src/server/inbox/agents/supervisor/ticket-actions';
import { feedbackApp } from '../src/server/http/feedback';
import { buildFeedbackLinks } from '../src/lib/feedback-links';
import {
  addMember,
  createWorkspaceTestDb,
  seedMailbox,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

describe('ticket feedback', () => {
  it('records scoped ticket feedback with an audit trail', async () => {
    const { db, env } = createWorkspaceTestDb();
    await seedUser(db, 'usr_1', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    addMember(db, 'ws_a', 'usr_1', 'owner');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
    db.prepare(
      `INSERT INTO ticket (
        id, workspace_id, mailbox_id, subject, last_message_at, requester_email,
        thread_token, created_at, updated_at
      ) VALUES ('tkt_1', 'ws_a', 'mb_a', 'Refund', 1, 'a@example.com', 'tok', 1, 1)`,
    ).run();

    const result = await recordFeedback(env as any, 'ws_a', {
      ticketId: 'tkt_1',
      actorUserId: 'usr_1',
      rating: 'negative',
      comment: 'Missing detail',
    });

    expect(result.ok).toBe(true);
    expect(db.prepare(`SELECT rating, comment FROM ticket_feedback WHERE ticket_id = 'tkt_1'`).get())
      .toEqual({ rating: 'negative', comment: 'Missing detail' });
    expect(db.prepare(`SELECT action FROM audit_event WHERE ticket_id = 'tkt_1'`).get())
      .toEqual({ action: 'ticket.feedback_recorded' });
  });

  it('records signed customer feedback links and updates outcome rollups', async () => {
    const { db, env } = createWorkspaceTestDb();
    const routeEnv = {
      ...env,
      APP_URL: 'https://support.example.com',
      COOKIE_SIGNING_KEY: 'test-secret',
    };
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
      ) VALUES ('msg_out', 'tkt_1', 'ws_a', 'outbound', '<out@example.com>', 2, 2)`,
    ).run();

    const links = await buildFeedbackLinks(routeEnv as any, {
      workspaceId: 'ws_a',
      ticketId: 'tkt_1',
      messageId: 'msg_out',
    });
    const token = new URL(links!.positive).searchParams.get('token')!;
    const res = await feedbackApp.request(`/?token=${encodeURIComponent(token)}`, {}, routeEnv);

    expect(res.status).toBe(200);
    expect(db.prepare(
      `SELECT rating, source FROM ticket_feedback WHERE ticket_id = 'tkt_1'`,
    ).get()).toEqual({ rating: 'positive', source: 'customer' });
    expect(db.prepare(
      `SELECT positive_feedback_count FROM workspace_outcome_daily WHERE workspace_id = 'ws_a'`,
    ).get()).toEqual({ positive_feedback_count: 1 });
  });
});
