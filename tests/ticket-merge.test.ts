import { describe, expect, it } from 'vitest';
import { mergeTickets } from '../src/server/actions/merge';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedWorkspace(db, 'ws_b', 'Beta');
  db.exec(`CREATE VIRTUAL TABLE message_fts USING fts5(
      content, message_id UNINDEXED, ticket_id UNINDEXED, workspace_id UNINDEXED);
    CREATE TABLE tag (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      color TEXT, created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
    CREATE TABLE ticket_tag (ticket_id TEXT NOT NULL, tag_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (ticket_id, tag_id))`);
  let n = 0;
  const addTicket = (ws: string, id: string, lastMessageAt = 1) => {
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, requester_email, thread_token, status, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'mb', 'S', 'c@x.com', ?, 'open', ?, 1, 1)`,
    ).run(id, ws, `tok${++n}`, lastMessageAt);
  };
  const addMessage = (ws: string, ticketId: string, id: string) => {
    db.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, sent_at, created_at)
       VALUES (?, ?, ?, 'inbound', 1, 1)`,
    ).run(id, ticketId, ws);
    db.prepare(
      `INSERT INTO message_fts (content, message_id, ticket_id, workspace_id) VALUES ('x', ?, ?, ?)`,
    ).run(id, ticketId, ws);
  };
  return { db, env, addTicket, addMessage };
}

describe('ticket merge', () => {
  it('moves messages, pending approvals, and search rows, then closes the source', async () => {
    const { db, env, addTicket, addMessage } = setup();
    addTicket('ws_a', 't_target', 5);
    addTicket('ws_a', 't_source', 9);
    addMessage('ws_a', 't_source', 'm_1');
    db.prepare(
      `INSERT INTO approval_request (id, workspace_id, ticket_id, kind, status, proposed_json, created_at)
       VALUES ('ap_1', 'ws_a', 't_source', 'send_reply', 'pending', '{}', 1)`,
    ).run();

    expect(await mergeTickets(env, 'ws_a', 't_target', 't_source', 'usr_1')).toBe('ok');

    const msg = db.prepare(`SELECT ticket_id FROM message_index WHERE id = 'm_1'`).get() as any;
    expect(msg.ticket_id).toBe('t_target');
    const fts = db
      .prepare(`SELECT ticket_id FROM message_fts WHERE message_id = 'm_1'`)
      .get() as any;
    expect(fts.ticket_id).toBe('t_target');
    const approval = db
      .prepare(`SELECT ticket_id FROM approval_request WHERE id = 'ap_1'`)
      .get() as any;
    expect(approval.ticket_id).toBe('t_target');

    const source = db.prepare(`SELECT status FROM ticket WHERE id = 't_source'`).get() as any;
    expect(source.status).toBe('closed');
    const target = db
      .prepare(`SELECT last_message_at FROM ticket WHERE id = 't_target'`)
      .get() as any;
    expect(target.last_message_at).toBe(9);
    const audits = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_event WHERE action = 'ticket.merged'`)
      .get() as any;
    expect(audits.n).toBe(2);
  });

  it('refuses self-merge and cross-workspace merges', async () => {
    const { env, addTicket } = setup();
    addTicket('ws_a', 't_a');
    addTicket('ws_b', 't_b');
    expect(await mergeTickets(env, 'ws_a', 't_a', 't_a', 'usr_1')).toBe('invalid');
    expect(await mergeTickets(env, 'ws_a', 't_a', 't_b', 'usr_1')).toBe('not_found');
  });
});
