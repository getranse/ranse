import { describe, expect, it } from 'vitest';
import { autoAssignNewTicket, pickRoundRobinAssignee } from '../src/server/actions/team-assignment';
import { addTeamMember, createTeam, deleteTeam, listTeams } from '../src/server/actions/teams';
import { addMember, createWorkspaceTestDb, seedUser, seedWorkspace } from './helpers/workspace-db';

async function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  db.exec(`CREATE TABLE team (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
    CREATE TABLE team_member (
      team_id TEXT NOT NULL, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id));
    ALTER TABLE ticket ADD COLUMN team_id TEXT`);
  for (const u of ['usr_1', 'usr_2']) {
    await seedUser(db, u, `${u}@x.com`);
    addMember(db, 'ws_a', u, 'agent');
  }
  const addTicket = (id: string, assignee: string | null, status = 'open') => {
    db.prepare(
      `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, requester_email, assignee_user_id, status, thread_token, last_message_at, created_at, updated_at)
       VALUES (?, 'ws_a', 'mb_1', 'S', 'c@x.com', ?, ?, ?, 1, 1, 1)`,
    ).run(id, assignee, status, `tok-${id}`);
  };
  return { db, env, addTicket };
}

describe('teams', () => {
  it('creates teams, tracks member counts, and rejects outside users', async () => {
    const { env } = await setup();
    const team = await createTeam(env, 'ws_a', 'Support');
    expect(await addTeamMember(env, 'ws_a', team.id, 'usr_1')).toBe(true);
    expect(await addTeamMember(env, 'ws_a', team.id, 'stranger')).toBe(false);
    expect((await listTeams(env, 'ws_a'))[0].member_count).toBe(1);
    await deleteTeam(env, 'ws_a', team.id);
    expect(await listTeams(env, 'ws_a')).toHaveLength(0);
  });

  it('round-robins to the member with the lightest open load', async () => {
    const { env, addTicket } = await setup();
    const team = await createTeam(env, 'ws_a', 'Support');
    await addTeamMember(env, 'ws_a', team.id, 'usr_1');
    await addTeamMember(env, 'ws_a', team.id, 'usr_2');
    addTicket('t_1', 'usr_1');
    addTicket('t_2', 'usr_1');
    addTicket('t_3', 'usr_2');
    addTicket('t_4', 'usr_1', 'resolved'); // resolved tickets don't count

    expect(await pickRoundRobinAssignee(env, 'ws_a', team.id)).toBe('usr_2');
    expect(await pickRoundRobinAssignee(env, 'ws_a', 'no-such-team')).toBeNull();
  });

  it('auto-assigns new tickets when the mailbox has a default team', async () => {
    const { db, env, addTicket } = await setup();
    const team = await createTeam(env, 'ws_a', 'Support');
    await addTeamMember(env, 'ws_a', team.id, 'usr_2');
    db.prepare(
      `INSERT INTO mailbox (id, workspace_id, address, reply_signing_secret, created_at, default_team_id)
       VALUES ('mb_1', 'ws_a', 'support@a.com', 's', 1, ?)`,
    ).run(team.id);
    addTicket('t_new', null);

    await autoAssignNewTicket(env, 'ws_a', 't_new', 'mb_1');
    const row = db
      .prepare(`SELECT team_id, assignee_user_id FROM ticket WHERE id = 't_new'`)
      .get() as any;
    expect(row.team_id).toBe(team.id);
    expect(row.assignee_user_id).toBe('usr_2');

    // Mailboxes without a default team leave the ticket untouched.
    db.prepare(
      `INSERT INTO mailbox (id, workspace_id, address, reply_signing_secret, created_at)
       VALUES ('mb_2', 'ws_a', 'other@a.com', 's', 1)`,
    ).run();
    addTicket('t_plain', null);
    await autoAssignNewTicket(env, 'ws_a', 't_plain', 'mb_2');
    const plain = db
      .prepare(`SELECT team_id, assignee_user_id FROM ticket WHERE id = 't_plain'`)
      .get() as any;
    expect(plain.team_id).toBeNull();
    expect(plain.assignee_user_id).toBeNull();
  });
});
