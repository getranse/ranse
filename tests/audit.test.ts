import { describe, expect, it } from 'vitest';
import { audit, diffChanges, isReadLoggingEnabled, verifyAuditChain } from '../src/server/lib/audit';
import { auditMeta } from '../src/types/audit';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

describe('audit', () => {
  it('derives category/severity from the catalog and snapshots actor identity', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    db.exec(`INSERT INTO user (id, email, name, created_at) VALUES ('u1', 'ann@example.com', 'Ann', 1)`);

    await audit(env as any, {
      workspaceId: 'ws_a',
      actorType: 'user',
      actorId: 'u1',
      action: 'auth.login',
    });

    const row = db.prepare(`SELECT * FROM audit_event WHERE workspace_id = 'ws_a'`).get() as any;
    expect(row.category).toBe('auth');
    expect(row.severity).toBe('notice');
    expect(row.actor_email).toBe('ann@example.com');
    expect(row.actor_name).toBe('Ann');
    expect(row.hash).toBeTruthy();
    expect(row.prev_hash).toBeNull();
  });

  it('builds a verifiable hash chain and detects tampering', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    for (let i = 0; i < 3; i++) {
      await audit(env as any, { workspaceId: 'ws_a', actorType: 'system', action: 'reply.sent' });
    }

    const intact = await verifyAuditChain(env as any, 'ws_a');
    expect(intact.ok).toBe(true);
    expect(intact.checked).toBe(3);

    const first = db
      .prepare(`SELECT id FROM audit_event WHERE workspace_id = 'ws_a' ORDER BY rowid LIMIT 1`)
      .get() as any;
    db.prepare(`UPDATE audit_event SET payload_json = '{"tampered":true}' WHERE id = ?`).run(first.id);

    const broken = await verifyAuditChain(env as any, 'ws_a');
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(first.id);
  });

  it('chains successive events (prev_hash links to the previous row hash)', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await audit(env as any, { workspaceId: 'ws_a', actorType: 'system', action: 'reply.sent' });
    await audit(env as any, { workspaceId: 'ws_a', actorType: 'system', action: 'reply.sent' });

    const rows = db
      .prepare(`SELECT prev_hash, hash FROM audit_event WHERE workspace_id = 'ws_a' ORDER BY rowid`)
      .all() as any[];
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[1].prev_hash).toBe(rows[0].hash);
  });

  it('diffChanges returns only changed fields', () => {
    expect(diffChanges({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: { from: 2, to: 3 } });
    expect(diffChanges({ a: 1 }, { a: 1 })).toEqual({});
  });

  it('unknown actions fall back to general/info', () => {
    expect(auditMeta('totally.unknown')).toEqual({ category: 'general', severity: 'info' });
    expect(auditMeta('auth.login_failed')).toEqual({ category: 'security', severity: 'warning' });
  });

  it('read-access logging is off unless the workspace opts in', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_off', 'Off');
    // Default settings ('{}') — the high-volume PII read log must stay off.
    expect(await isReadLoggingEnabled(env as any, 'ws_off')).toBe(false);

    db.prepare(`UPDATE workspace SET settings_json = ? WHERE id = 'ws_off'`).run(
      JSON.stringify({ audit_read_logging: true }),
    );
    expect(await isReadLoggingEnabled(env as any, 'ws_off')).toBe(true);

    // Unknown workspace resolves to false rather than throwing.
    expect(await isReadLoggingEnabled(env as any, 'ws_missing')).toBe(false);
  });
});
