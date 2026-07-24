import { describe, expect, it } from 'vitest';
import { buildFeedbackLinks } from '../src/lib/feedback-links';
import { feedbackApp } from '../src/server/http/feedback';
import { createWorkspaceTestDb, seedMailbox, seedWorkspace } from './helpers/workspace-db';

async function setup() {
  const { db, env } = createWorkspaceTestDb();
  const routeEnv = {
    ...env,
    APP_URL: 'https://support.example.com',
    COOKIE_SIGNING_KEY: 'test-secret',
  };
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, last_message_at, requester_email, thread_token, created_at, updated_at)
     VALUES ('tkt_1', 'ws_a', 'mb_a', 'Refund', 1, 'a@example.com', 'tok', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO message_index (id, ticket_id, workspace_id, direction, sent_at, created_at)
     VALUES ('msg_out', 'tkt_1', 'ws_a', 'outbound', 2, 2)`,
  ).run();
  const links = await buildFeedbackLinks(routeEnv as any, {
    workspaceId: 'ws_a',
    ticketId: 'tkt_1',
    messageId: 'msg_out',
  });
  const token = new URL(links!.positive).searchParams.get('token')!;
  return { db, routeEnv, token };
}

function surveyForm(token: string, score: string, comment = 'Fast and friendly') {
  const body = new URLSearchParams({ token, score, comment });
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

describe('survey CSAT', () => {
  it('offers the survey after the thumbs click and records the score + comment', async () => {
    const { db, routeEnv, token } = await setup();
    const thumbs = await feedbackApp.request(`/?token=${encodeURIComponent(token)}`, {}, routeEnv);
    expect(await thumbs.text()).toContain('How would you rate this support experience?');

    const res = await feedbackApp.request('/survey', surveyForm(token, '4'), routeEnv);
    expect(res.status).toBe(200);
    const row = db
      .prepare(`SELECT score, comment FROM ticket_feedback WHERE ticket_id = 'tkt_1'`)
      .get() as any;
    expect(row).toEqual({ score: 4, comment: 'Fast and friendly' });
  });

  it('rejects invalid scores, bad tokens, and surveys without a thumbs click', async () => {
    const { routeEnv, token } = await setup();
    expect((await feedbackApp.request('/survey', surveyForm(token, '9'), routeEnv)).status).toBe(
      400,
    );
    expect((await feedbackApp.request('/survey', surveyForm('forged', '3'), routeEnv)).status).toBe(
      400,
    );
    // No thumbs feedback recorded yet for this message → 404.
    expect((await feedbackApp.request('/survey', surveyForm(token, '3'), routeEnv)).status).toBe(
      404,
    );
  });
});
