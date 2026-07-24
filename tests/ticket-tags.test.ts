import { describe, expect, it } from 'vitest';
import {
  createTag,
  deleteTag,
  listTags,
  listTicketTags,
  tagTicket,
  untagTicket,
} from '../src/server/actions/tags';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedWorkspace(db, 'ws_b', 'Beta');
  db.exec(`CREATE TABLE tag (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT,
      created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
    CREATE TABLE ticket_tag (
      ticket_id TEXT NOT NULL, tag_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (ticket_id, tag_id))`);
  const addTicket = (ws: string, id: string) => {
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, requester_email, thread_token, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'mb', 'S', 'c@x.com', ?, 1, 1, 1)`,
    ).run(id, ws, `tok-${ws}-${id}`);
  };
  return { env, addTicket };
}

describe('tags', () => {
  it('creates tags idempotently by case-insensitive name', async () => {
    const { env } = setup();
    const a = await createTag(env, 'ws_a', 'Billing');
    const b = await createTag(env, 'ws_a', 'billing');
    expect(b.id).toBe(a.id);
    // Same name in another workspace is a distinct tag.
    const other = await createTag(env, 'ws_b', 'Billing');
    expect(other.id).not.toBe(a.id);
    expect((await listTags(env, 'ws_a')).map((t) => t.name)).toEqual(['Billing']);
  });

  it('assigns and removes tags, deduping repeat assignments', async () => {
    const { env, addTicket } = setup();
    addTicket('ws_a', 't_1');
    const tag = await createTag(env, 'ws_a', 'refund');
    expect(await tagTicket(env, 'ws_a', 't_1', tag.id)).toBe(true);
    expect(await tagTicket(env, 'ws_a', 't_1', tag.id)).toBe(true);
    expect(await listTicketTags(env, 'ws_a', 't_1')).toHaveLength(1);

    await untagTicket(env, 'ws_a', 't_1', tag.id);
    expect(await listTicketTags(env, 'ws_a', 't_1')).toHaveLength(0);
  });

  it('refuses cross-workspace assignment in both directions', async () => {
    const { env, addTicket } = setup();
    addTicket('ws_a', 't_a');
    addTicket('ws_b', 't_b');
    const tagA = await createTag(env, 'ws_a', 'vip');
    // ws_b's ticket with ws_a's tag, and ws_a's ticket claimed via ws_b.
    expect(await tagTicket(env, 'ws_b', 't_b', tagA.id)).toBe(false);
    expect(await tagTicket(env, 'ws_b', 't_a', tagA.id)).toBe(false);
  });

  it('deleting a tag removes its assignments too', async () => {
    const { env, addTicket } = setup();
    addTicket('ws_a', 't_1');
    const tag = await createTag(env, 'ws_a', 'temp');
    await tagTicket(env, 'ws_a', 't_1', tag.id);
    await deleteTag(env, 'ws_a', tag.id);
    expect(await listTags(env, 'ws_a')).toHaveLength(0);
    expect(await listTicketTags(env, 'ws_a', 't_1')).toHaveLength(0);
  });
});
