import { DatabaseSync } from 'node:sqlite';
import { authApp } from '../../src/auth/routes';
import { hashPassword } from '../../src/lib/password';

export function createWorkspaceTestDb() {
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
    batch: async (statements: { run: () => Promise<unknown> }[]) =>
      Promise.all(statements.map((statement) => statement.run())),
  };

  return { db, env: { DB: envDb, COOKIE_SIGNING_KEY: 'test-secret' } as any };
}

export async function seedUser(
  db: DatabaseSync,
  id: string,
  email: string,
  password = 'long-enough-password',
) {
  db.prepare(`INSERT INTO user (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, email, email.split('@')[0], await hashPassword(password), 1);
}

export function seedWorkspace(db: DatabaseSync, id: string, name: string) {
  db.prepare(
    `INSERT INTO workspace (id, name, slug, settings_json, created_at, updated_at) VALUES (?, ?, ?, '{}', 1, 1)`,
  ).run(id, name, name.toLowerCase().replace(/\s+/g, '-'));
}

export function addMember(db: DatabaseSync, workspaceId: string, userId: string, role: string) {
  db.prepare(`INSERT INTO workspace_user (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 1)`)
    .run(workspaceId, userId, role);
}

export function seedMailbox(
  db: DatabaseSync,
  workspaceId: string,
  id: string,
  address: string,
  secret = `${id}_secret`,
) {
  db.prepare(
    `INSERT INTO mailbox (id, workspace_id, address, display_name, reply_signing_secret, auto_reply_policy, created_at)
     VALUES (?, ?, ?, ?, ?, 'safe', 1)`,
  ).run(id, workspaceId, address, address.split('@')[0], secret);
}

export async function login(env: any, email: string, password = 'long-enough-password') {
  const res = await authApp.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, env);
  if (res.status !== 200) throw new Error(`login_failed:${email}:${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0];
}
