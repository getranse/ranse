import { describe, expect, it } from 'vitest';
import {
  ageStalenessComponent,
  combineStalenessComponents,
  computeKnowledgeHealth,
  discountedRetrievalScore,
  markSourceStale,
  recomputeWorkspaceStaleness,
} from '../src/server/platform/insights/staleness';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function seedSource(
  db: any,
  workspaceId: string,
  id: string,
  options: {
    title?: string;
    last_crawled_at?: number | null;
  } = {},
) {
  db.prepare(
    `INSERT INTO knowledge_source (
      id, workspace_id, kind, title, status, last_crawled_at, updated_at
    ) VALUES (?, ?, 'manual', ?, 'ready', ?, 1)`,
  ).run(id, workspaceId, options.title ?? id, options.last_crawled_at ?? null);
}

describe('knowledge staleness', () => {
  it('age component grows from 0 at fresh to ~0.5 at the half-life', () => {
    const now = 1_000_000;
    const halfLife = 180 * 24 * 60 * 60_000;
    expect(ageStalenessComponent(now, now)).toBe(0);
    const half = ageStalenessComponent(now - halfLife, now);
    expect(half).toBeCloseTo(0.5, 3);
    const older = ageStalenessComponent(now - halfLife * 4, now);
    expect(older).toBeGreaterThan(0.9);
  });

  it('penalizes never-crawled sources', () => {
    expect(ageStalenessComponent(null)).toBeGreaterThan(0.5);
  });

  it('manual override pins the score regardless of components', () => {
    expect(combineStalenessComponents({ age: 0.9, drift: 0.5, manual: 0.2 })).toBe(0.2);
    expect(combineStalenessComponents({ age: 0, drift: 0, manual: 1 })).toBe(1);
  });

  it('combines age + drift up to 1.0', () => {
    expect(combineStalenessComponents({ age: 0.5, drift: 0.3, manual: 0 })).toBeCloseTo(0.8);
    expect(combineStalenessComponents({ age: 0.9, drift: 0.5, manual: 0 })).toBe(1);
  });

  it('discounted retrieval score halves at staleness 1.0', () => {
    expect(discountedRetrievalScore(1, 0)).toBe(1);
    expect(discountedRetrievalScore(1, 1)).toBeCloseTo(0.5);
    expect(discountedRetrievalScore(1, 0.5)).toBeCloseTo(0.75);
  });

  it('recomputeWorkspaceStaleness writes the score back to each source', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const now = Date.now();
    seedSource(db, 'ws_a', 'src_fresh', { last_crawled_at: now });
    seedSource(db, 'ws_a', 'src_old', { last_crawled_at: now - 365 * 24 * 60 * 60_000 });
    seedSource(db, 'ws_a', 'src_unknown', { last_crawled_at: null });
    const result = await recomputeWorkspaceStaleness(env as any, 'ws_a', { now });
    expect(result.examined).toBe(3);
    const rows = db.prepare(`SELECT id, staleness_score FROM knowledge_source ORDER BY id`).all() as any[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.staleness_score]));
    expect(byId.src_fresh).toBeLessThan(0.05);
    expect(byId.src_old).toBeGreaterThan(0.7);
    expect(byId.src_unknown).toBeGreaterThan(0.4);
  });

  it('mark_stale persists a manual score that overrides recompute', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSource(db, 'ws_a', 'src_1', { last_crawled_at: Date.now() });
    await markSourceStale(env as any, {
      workspaceId: 'ws_a',
      sourceId: 'src_1',
      score: 0.95,
      reason: 'Outdated policy',
      actorUserId: 'usr_1',
    });
    const row = db.prepare(`SELECT staleness_score, staleness_marked_by FROM knowledge_source WHERE id = 'src_1'`).get() as any;
    expect(row.staleness_score).toBe(0.95);
    expect(row.staleness_marked_by).toBe('usr_1');
    // After recompute, the manual override should win even though the source is fresh.
    await recomputeWorkspaceStaleness(env as any, 'ws_a');
    const after = db.prepare(`SELECT staleness_score FROM knowledge_source WHERE id = 'src_1'`).get() as any;
    expect(after.staleness_score).toBe(0.95);
  });

  it('computes a knowledge health grade from average staleness', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedSource(db, 'ws_a', 'src_1', { last_crawled_at: Date.now() });
    seedSource(db, 'ws_a', 'src_2', { last_crawled_at: Date.now() - 400 * 24 * 60 * 60_000 });
    await recomputeWorkspaceStaleness(env as any, 'ws_a');
    const health = await computeKnowledgeHealth(env as any, 'ws_a');
    expect(health.totalSourceCount).toBe(2);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(health.grade);
    expect(health.staleSourceCount).toBeGreaterThan(0);
  });
});
