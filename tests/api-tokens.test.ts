import { describe, expect, it } from 'vitest';
import {
  createApiToken,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
} from '../src/server/actions/api-tokens';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  db.exec(`CREATE TABLE api_token (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL, role TEXT NOT NULL,
    created_by TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER)`);
  return { db, env };
}

describe('api tokens', () => {
  it('returns the raw token once and stores only a hash', async () => {
    const { db, env } = setup();
    const { token, record } = await createApiToken(env, {
      workspaceId: 'ws_a',
      name: 'CI',
      role: 'agent',
      createdBy: 'usr_1',
    });
    expect(token).toMatch(/^ranse_[0-9a-f]{48}$/);
    expect(record.token_prefix).toBe(token.slice(0, 12));
    const row = db.prepare(`SELECT token_hash FROM api_token WHERE id = ?`).get(record.id) as any;
    expect(row.token_hash).not.toContain(token);
    // Listing never exposes the hash or raw token.
    const listed = await listApiTokens(env, 'ws_a');
    expect(JSON.stringify(listed)).not.toContain(row.token_hash);
  });

  it('resolves a valid bearer to its workspace and role, stamping last_used_at', async () => {
    const { env } = setup();
    const { token } = await createApiToken(env, {
      workspaceId: 'ws_a',
      name: 'CI',
      role: 'viewer',
      createdBy: 'usr_1',
    });
    const resolved = await resolveApiToken(env, token);
    expect(resolved).toMatchObject({ workspaceId: 'ws_a', role: 'viewer' });
    const [listed] = await listApiTokens(env, 'ws_a');
    expect(listed.last_used_at).toBeGreaterThan(0);
  });

  it('rejects unknown, malformed, and revoked tokens', async () => {
    const { env } = setup();
    const { token, record } = await createApiToken(env, {
      workspaceId: 'ws_a',
      name: 'CI',
      role: 'admin',
      createdBy: 'usr_1',
    });
    expect(await resolveApiToken(env, 'ranse_deadbeef')).toBeNull();
    expect(await resolveApiToken(env, 'not-a-token')).toBeNull();
    await revokeApiToken(env, 'ws_a', record.id);
    expect(await resolveApiToken(env, token)).toBeNull();
  });
});
