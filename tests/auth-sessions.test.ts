import { describe, expect, it } from 'vitest';
import { authApp } from '../src/server/http/auth';
import { addMember, createWorkspaceTestDb, login, seedUser, seedWorkspace } from './helpers/workspace-db';

describe('auth sessions', () => {
  it('revoke-others kills every other session, keeps the current one, and audits it', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_1', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_1', 'owner');

    // Two independent sign-ins => two live sessions for the same user.
    const keep = await login(env, 'owner@example.com');
    await login(env, 'owner@example.com');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session WHERE user_id = 'usr_1'`).get() as any).n).toBe(2);

    const res = await authApp.request(
      '/sessions/revoke-others',
      { method: 'POST', headers: { cookie: keep } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, revoked: 1 });

    // Only the calling session survives.
    const sessions = db.prepare(`SELECT id FROM session WHERE user_id = 'usr_1'`).all() as any[];
    expect(sessions).toHaveLength(1);

    // The revocation is recorded under the user's workspace.
    const event = db
      .prepare(`SELECT * FROM audit_event WHERE action = 'auth.session_revoked'`)
      .get() as any;
    expect(event.workspace_id).toBe('ws_a');
    expect(event.actor_id).toBe('usr_1');
    expect(event.category).toBe('security');
    expect(JSON.parse(event.payload_json)).toMatchObject({ scope: 'others', revoked: 1 });
  });

  it('revoke-others requires a session', async () => {
    const { env } = createWorkspaceTestDb();
    const res = await authApp.request('/sessions/revoke-others', { method: 'POST' }, env);
    expect(res.status).toBe(401);
  });
});
