import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/api/routes';
import { authApp } from '../src/auth/routes';
import { buildReplyAddress } from '../src/email/reply-security';
import { resolveMailboxForRecipients } from '../src/email/routing';
import { hashPassword } from '../src/lib/password';
import { r2Keys } from '../src/lib/storage';

vi.mock('agents', () => ({ getAgentByName: () => ({}) }));

function createD1LikeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      archived_at INTEGER,
      deleted_at INTEGER
    );
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE workspace_user (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE audit_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      ticket_id TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_invitation (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      accepted_at INTEGER,
      expires_at INTEGER NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE mailbox (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      display_name TEXT,
      reply_signing_secret TEXT NOT NULL,
      auto_reply_policy TEXT NOT NULL DEFAULT 'safe',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE ticket (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      mailbox_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      last_message_at INTEGER NOT NULL,
      requester_email TEXT NOT NULL,
      thread_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE message_index (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE knowledge_source (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE notification_channel (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_llm_config (
      workspace_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      model_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, action_key)
    );
  `);

  const envDb = {
    prepare(sql: string) {
      const run = (params: unknown[]) => ({
        all: async () => ({ results: db.prepare(sql).all(...(params as any[])) }),
        first: async () => db.prepare(sql).get(...(params as any[])),
        run: async () => {
          db.prepare(sql).run(...(params as any[]));
          return { success: true };
        },
      });
      return { bind: (...params: unknown[]) => run(params), ...run([]) };
    },
    batch: async (statements: { run: () => Promise<unknown> }[]) => Promise.all(statements.map((s) => s.run())),
  };

  return { db, env: { DB: envDb, COOKIE_SIGNING_KEY: 'test-secret' } as any };
}

async function seedUser(db: DatabaseSync, id: string, email: string, password = 'long-enough-password') {
  db.prepare(`INSERT INTO user (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, email, email.split('@')[0], await hashPassword(password), 1);
}

function seedWorkspace(db: DatabaseSync, id: string, name: string) {
  db.prepare(`INSERT INTO workspace (id, name, slug, settings_json, created_at, updated_at) VALUES (?, ?, ?, '{}', 1, 1)`)
    .run(id, name, name.toLowerCase().replace(/\s+/g, '-'));
}

function addMember(db: DatabaseSync, workspaceId: string, userId: string, role: string) {
  db.prepare(`INSERT INTO workspace_user (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 1)`)
    .run(workspaceId, userId, role);
}

function seedMailbox(db: DatabaseSync, workspaceId: string, id: string, address: string, secret = `${id}_secret`) {
  db.prepare(
    `INSERT INTO mailbox (id, workspace_id, address, display_name, reply_signing_secret, auto_reply_policy, created_at)
     VALUES (?, ?, ?, ?, ?, 'safe', 1)`,
  ).run(id, workspaceId, address, address.split('@')[0], secret);
}

async function login(env: any, email: string, password = 'long-enough-password') {
  const res = await authApp.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, env);
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

describe('workspace platform routes', () => {
  it('does not pick a first workspace when a user belongs to more than one', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'usr_1', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_b', 'Beta');
    addMember(db, 'ws_a', 'usr_1', 'owner');
    addMember(db, 'ws_b', 'usr_1', 'admin');

    const cookie = await login(env, 'owner@example.com');
    const me = await authApp.request('/me', { headers: { cookie } }, env);
    const body: any = await me.json();

    expect(body.currentWorkspaceId).toBeUndefined();
    expect(body.workspaces.map((w: any) => w.id)).toEqual(['ws_a', 'ws_b']);

    const switched = await authApp.request('/workspaces/switch', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: 'ws_b' }),
    }, env);
    expect(switched.status).toBe(200);

    const selected: any = await (await authApp.request('/me', { headers: { cookie } }, env)).json();
    expect(selected.currentWorkspaceId).toBe('ws_b');
  });

  it('rejects switching to a workspace where the user is not a member', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'usr_1', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_b', 'Beta');
    addMember(db, 'ws_a', 'usr_1', 'owner');

    const cookie = await login(env, 'owner@example.com');
    const res = await authApp.request('/workspaces/switch', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: 'ws_b' }),
    }, env);

    expect(res.status).toBe(403);
  });

  it('creates another workspace and selects it for the session', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'usr_1', 'owner@example.com');

    const cookie = await login(env, 'owner@example.com');
    const res = await authApp.request('/workspaces', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Team' }),
    }, env);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspace.name).toBe('New Team');
    expect(db.prepare(`SELECT role FROM workspace_user WHERE workspace_id = ? AND user_id = ?`).get(body.workspaceId, 'usr_1')).toEqual({ role: 'owner' });
  });

  it('enforces invite roles and accepts matching invitations', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'owner', 'owner@example.com');
    await seedUser(db, 'admin', 'admin@example.com');
    await seedUser(db, 'viewer', 'viewer@example.com');
    await seedUser(db, 'agent', 'agent@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    addMember(db, 'ws_a', 'owner', 'owner');
    addMember(db, 'ws_a', 'admin', 'admin');
    addMember(db, 'ws_a', 'viewer', 'viewer');

    const viewerCookie = await login(env, 'viewer@example.com');
    const forbidden = await apiApp.request('/workspaces/current/invitations', {
      method: 'POST',
      headers: { cookie: viewerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'agent@example.com', role: 'agent' }),
    }, env);
    expect(forbidden.status).toBe(403);

    const adminCookie = await login(env, 'admin@example.com');
    const ownerInvite = await apiApp.request('/workspaces/current/invitations', {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'agent@example.com', role: 'owner' }),
    }, env);
    expect(ownerInvite.status).toBe(403);

    const ownerCookie = await login(env, 'owner@example.com');
    const invited = await apiApp.request('/workspaces/current/invitations', {
      method: 'POST',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'agent@example.com', role: 'agent' }),
    }, env);
    const inviteBody: any = await invited.json();
    expect(invited.status).toBe(200);

    const agentCookie = await login(env, 'agent@example.com');
    const accepted = await authApp.request('/invitations/accept', {
      method: 'POST',
      headers: { cookie: agentCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token: inviteBody.invitation.token }),
    }, env);

    expect(accepted.status).toBe(200);
    expect(db.prepare(`SELECT role FROM workspace_user WHERE workspace_id = 'ws_a' AND user_id = 'agent'`).get())
      .toEqual({ role: 'agent' });
    expect(inviteBody.invitation.accept_url).toContain('/invite/');
  });

  it('uses middleware role gates across sensitive route families', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'viewer', 'viewer@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    addMember(db, 'ws_a', 'viewer', 'viewer');

    const cookie = await login(env, 'viewer@example.com');
    const requests = [
      ['/tickets/t_1/status', { status: 'closed' }],
      ['/approvals/apr_1/reject', { reason: 'no' }],
      ['/knowledge', { kind: 'manual', title: 'A', body: 'B' }],
      ['/notifications/channels', { kind: 'email', target: 'a@example.com', events: ['ticket.created'] }],
      ['/settings/workspace', { from_name: 'Nope' }],
      ['/workspaces/current/invitations', { email: 'a@example.com', role: 'agent' }],
    ] as const;

    for (const [path, body] of requests) {
      const res = await apiApp.request(path, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, env);
      expect(res.status, path).toBe(403);
    }
  });

  it('keeps mailbox, audit, and usage reads scoped to the active workspace', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'owner', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_b', 'Beta');
    addMember(db, 'ws_a', 'owner', 'owner');
    seedMailbox(db, 'ws_a', 'mb_a', 'support-a@example.com');
    seedMailbox(db, 'ws_b', 'mb_b', 'support-b@example.com');
    db.prepare(`INSERT INTO ticket (id, workspace_id, mailbox_id, subject, last_message_at, requester_email, thread_token, created_at, updated_at) VALUES ('t1', 'ws_a', 'mb_a', 'A', 1, 'a@x.com', 'ta', 1, 1)`).run();
    db.prepare(`INSERT INTO ticket (id, workspace_id, mailbox_id, subject, last_message_at, requester_email, thread_token, created_at, updated_at) VALUES ('t2', 'ws_b', 'mb_b', 'B', 1, 'b@x.com', 'tb', 1, 1)`).run();
    db.prepare(`INSERT INTO audit_event (id, workspace_id, actor_type, action, created_at) VALUES ('aud_a', 'ws_a', 'user', 'workspace.a', 2)`).run();
    db.prepare(`INSERT INTO audit_event (id, workspace_id, actor_type, action, created_at) VALUES ('aud_b', 'ws_b', 'user', 'workspace.b', 2)`).run();

    const cookie = await login(env, 'owner@example.com');
    const mailboxes: any = await (await apiApp.request('/workspaces/current/mailboxes', { headers: { cookie } }, env)).json();
    const usage: any = await (await apiApp.request('/workspaces/current/usage', { headers: { cookie } }, env)).json();
    const audit: any = await (await apiApp.request('/workspaces/current/audit', { headers: { cookie } }, env)).json();

    expect(mailboxes.mailboxes.map((m: any) => m.id)).toEqual(['mb_a']);
    expect(usage.usage.tickets).toBe(1);
    expect(audit.events.map((e: any) => e.id)).toEqual(['aud_a']);
  });

  it('moves the session to a remaining workspace after archive and delete', async () => {
    const { db, env } = createD1LikeDb();
    await seedUser(db, 'owner', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_b', 'Beta');
    addMember(db, 'ws_a', 'owner', 'owner');
    addMember(db, 'ws_b', 'owner', 'owner');

    const cookie = await login(env, 'owner@example.com');
    await authApp.request('/workspaces/switch', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: 'ws_a' }),
    }, env);
    const archived = await apiApp.request('/workspaces/current/archive', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'archive' }),
    }, env);
    expect((await archived.json() as any).currentWorkspaceId).toBe('ws_b');

    const removed = await apiApp.request('/workspaces/current', {
      method: 'DELETE',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'delete' }),
    }, env);
    expect((await removed.json() as any).currentWorkspaceId).toBeUndefined();
  });

  it('keeps mailbox routing and storage keys workspace-safe', async () => {
    const { db, env } = createD1LikeDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedWorkspace(db, 'ws_b', 'Beta');
    seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com', 'secret_a');
    seedMailbox(db, 'ws_b', 'mb_b', 'help@example.com', 'secret_b');

    const direct = await resolveMailboxForRecipients(env, ['help@example.com']);
    const reply = await resolveMailboxForRecipients(env, [
      await buildReplyAddress({ supportDomain: 'example.com', ticketId: 'tkt_123', mailboxSecret: 'secret_a' }),
    ]);

    expect(direct?.workspaceId).toBe('ws_b');
    expect(reply).toMatchObject({ workspaceId: 'ws_a', mailboxId: 'mb_a', ticketId: 'tkt_123' });
    expect(r2Keys.rawEmail('ws_a', 'mb_a', 'msg_1')).toContain('/ws_a/mb_a/');
    expect(r2Keys.knowledgePdf('ws_b', 'ksrc_1', 'a.pdf')).toContain('/ws_b/');
  });
});
