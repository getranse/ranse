import { describe, expect, it } from 'vitest';
import { searchTickets, toMatchExpression } from '../src/server/actions/search';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedWorkspace(db, 'ws_b', 'Beta');
  db.exec(`CREATE VIRTUAL TABLE message_fts USING fts5(
    content, message_id UNINDEXED, ticket_id UNINDEXED, workspace_id UNINDEXED)`);
  let n = 0;
  const addTicket = (ws: string, id: string, subject: string, requester: string, text: string) => {
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, requester_email, requester_name, thread_token, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'mb', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ws, subject, requester, requester.split('@')[0], `tok${++n}`, n, n, n);
    db.prepare(
      `INSERT INTO message_fts (content, message_id, ticket_id, workspace_id) VALUES (?, ?, ?, ?)`,
    ).run(`${subject} ${text}`, `m${n}`, id, ws);
  };
  return { env, addTicket };
}

describe('toMatchExpression', () => {
  it('quotes tokens as prefix phrases and strips FTS operators', () => {
    expect(toMatchExpression('refund order')).toBe('"refund"* "order"*');
    expect(toMatchExpression('  a OR b  ')).toBe('"a"* "OR"* "b"*');
    expect(toMatchExpression('he said "hi" -x')).toBe('"he"* "said"* "hi"* "-x"*');
    expect(toMatchExpression('   ')).toBeNull();
  });
});

describe('searchTickets', () => {
  it('finds tickets by message content with prefix matching, scoped to the workspace', async () => {
    const { env, addTicket } = setup();
    addTicket('ws_a', 't_1', 'Broken widget', 'jane@customer.com', 'I want a refund for my order');
    addTicket('ws_a', 't_2', 'Login issue', 'bob@customer.com', 'cannot sign in');
    addTicket('ws_b', 't_3', 'Refund please', 'eve@other.com', 'refund my subscription');

    const hits = await searchTickets(env, 'ws_a', 'refun');
    expect(hits.map((h) => h.id)).toEqual(['t_1']);
    expect(hits[0].snippet).toContain('[refund]');
  });

  it('falls back to requester email/name matches without duplicating FTS hits', async () => {
    const { env, addTicket } = setup();
    addTicket('ws_a', 't_1', 'Hello jane', 'jane@customer.com', 'mentions jane in text');
    addTicket('ws_a', 't_2', 'Other topic', 'jane@customer.com', 'unrelated words entirely');

    const hits = await searchTickets(env, 'ws_a', 'jane');
    expect(hits.map((h) => h.id).sort()).toEqual(['t_1', 't_2']);
    expect(hits.filter((h) => h.id === 't_1')).toHaveLength(1);
  });

  it('returns nothing for empty queries and respects the limit cap', async () => {
    const { env, addTicket } = setup();
    for (let i = 0; i < 5; i++) {
      addTicket('ws_a', `t_${i}`, `Refund case ${i}`, `c${i}@x.com`, 'refund request');
    }
    expect(await searchTickets(env, 'ws_a', '')).toEqual([]);
    expect(await searchTickets(env, 'ws_a', 'refund', 3)).toHaveLength(3);
  });
});
