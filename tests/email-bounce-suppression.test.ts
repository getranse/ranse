import { describe, expect, it } from 'vitest';
import { isEmailSuppressed, processInboundBounce } from '../src/server/actions/suppression';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

describe('bounce suppression', () => {
  function setup() {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    db.exec(`CREATE TABLE email_suppression (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, address TEXT NOT NULL,
      reason TEXT NOT NULL, status_code TEXT, ticket_id TEXT,
      bounce_count INTEGER NOT NULL DEFAULT 1, last_bounce_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE (workspace_id, address))`);
    return { db, env };
  }

  it('hard bounce suppresses immediately; soft only after repeats', async () => {
    const { env } = setup();
    await processInboundBounce(env, {
      workspaceId: 'ws_a',
      ticketId: null,
      bounce: { kind: 'hard', recipient: 'gone@customer.com', status: '5.1.1' },
    });
    expect(await isEmailSuppressed(env, 'ws_a', 'GONE@customer.com')).toBe(true);

    const soft = { kind: 'soft' as const, recipient: 'slow@customer.com', status: '4.4.1' };
    await processInboundBounce(env, { workspaceId: 'ws_a', ticketId: null, bounce: soft });
    await processInboundBounce(env, { workspaceId: 'ws_a', ticketId: null, bounce: soft });
    expect(await isEmailSuppressed(env, 'ws_a', 'slow@customer.com')).toBe(false);
    await processInboundBounce(env, { workspaceId: 'ws_a', ticketId: null, bounce: soft });
    expect(await isEmailSuppressed(env, 'ws_a', 'slow@customer.com')).toBe(true);
  });

  it('falls back to the ticket requester and audits the bounce', async () => {
    const { db, env } = setup();
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, requester_email, thread_token, last_message_at, created_at, updated_at)
       VALUES ('t_1', 'ws_a', 'mb_1', 'Help', 'req@customer.com', 'tok', 1, 1, 1)`,
    ).run();
    const address = await processInboundBounce(env, {
      workspaceId: 'ws_a',
      ticketId: 't_1',
      bounce: { kind: 'hard', recipient: null, status: '5.2.2' },
    });
    expect(address).toBe('req@customer.com');
    expect(await isEmailSuppressed(env, 'ws_a', 'req@customer.com')).toBe(true);
    const event = db
      .prepare(`SELECT * FROM audit_event WHERE action = 'email.bounced'`)
      .get() as any;
    expect(event.workspace_id).toBe('ws_a');
    expect(JSON.parse(event.payload_json)).toMatchObject({
      address: 'req@customer.com',
      kind: 'hard',
    });
  });
});
