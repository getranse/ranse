import type { StalenessComponents, KnowledgeHealth } from '../../../interfaces/insights';
export type { StalenessComponents, KnowledgeHealth };
import type { Env } from '../../env';

// Knowledge staleness scoring. The score blends three components:
//   - age component:    smooth exponential decay since last_crawled_at
//   - drift component:  sources cited in low-CSAT replies in the last 30 days
//   - operator override: explicit mark_stale persists a manual score
//
// Score is in [0, 1]. The retrieval reranker multiplies retrieval scores by
// (1 - 0.5 * staleness) so a fully stale source is halved, never zeroed —
// operators still see it for review, the AI just stops grounding answers on it.

import { HALF_LIFE_MS, MAX_DRIFT_BUMP, STALE_THRESHOLD } from '../../../config/insights';

export function combineStalenessComponents(c: StalenessComponents): number {
  // Manual override pins the score (operator knowledge beats heuristics).
  if (c.manual > 0) return Math.min(1, c.manual);
  return Math.max(0, Math.min(1, c.age + c.drift));
}

export function ageStalenessComponent(lastCrawledAt: number | null, now: number = Date.now()): number {
  if (!lastCrawledAt) return 0.6; // Unknown freshness — penalize but not max
  const ageMs = Math.max(0, now - lastCrawledAt);
  // Exponential decay: 0 at fresh, 0.5 at half life, asymptotic to 1.
  return 1 - 0.5 ** (ageMs / HALF_LIFE_MS);
}

export function discountedRetrievalScore(rawScore: number, stalenessScore: number): number {
  const clamped = Math.max(0, Math.min(1, stalenessScore));
  return rawScore * (1 - 0.5 * clamped);
}

export async function recomputeWorkspaceStaleness(
  env: Env,
  workspaceId: string,
  options: { now?: number } = {},
): Promise<{ examined: number; stale: number }> {
  const now = options.now ?? Date.now();
  const sources = await env.DB.prepare(
    `SELECT id, last_crawled_at, staleness_marked_by FROM knowledge_source
       WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .all<{ id: string; last_crawled_at: number | null; staleness_marked_by: string | null }>();

  // Drift signal: sources cited in low-CSAT replies in the last 30 days.
  const driftWindow = now - 30 * 24 * 60 * 60_000;
  const driftRows = await env.DB.prepare(
    `SELECT json_extract(payload_json, '$.citesKnowledgeIds') AS cites,
            ticket_id, created_at
       FROM audit_event
      WHERE workspace_id = ? AND action IN ('reply.sent','reply.auto_sent')
        AND created_at >= ?`,
  )
    .bind(workspaceId, driftWindow)
    .all<{ cites: string; ticket_id: string; created_at: number }>();
  // Build chunk-id → drift count, then map up to source ids.
  const chunkDriftCount = new Map<string, number>();
  for (const row of driftRows.results ?? []) {
    if (!row.cites) continue;
    let parsed: string[];
    try {
      parsed = JSON.parse(row.cites);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    // Inflate drift count when the same ticket got negative feedback. We
    // join through ticket_feedback rather than carrying it on the audit row.
    const neg = await env.DB.prepare(
      `SELECT 1 FROM ticket_feedback WHERE workspace_id = ? AND ticket_id = ? AND rating = 'negative' LIMIT 1`,
    )
      .bind(workspaceId, row.ticket_id)
      .first();
    if (!neg) continue;
    for (const id of parsed) chunkDriftCount.set(id, (chunkDriftCount.get(id) ?? 0) + 1);
  }
  const chunkToSource = new Map<string, string>();
  if (chunkDriftCount.size > 0) {
    const ids = [...chunkDriftCount.keys()];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id, source_id FROM knowledge_chunk
        WHERE workspace_id = ? AND id IN (${placeholders})`,
    )
      .bind(workspaceId, ...ids)
      .all<{ id: string; source_id: string }>();
    for (const r of rows.results ?? []) chunkToSource.set(r.id, r.source_id);
  }
  const sourceDriftCount = new Map<string, number>();
  for (const [chunkId, count] of chunkDriftCount) {
    const sourceId = chunkToSource.get(chunkId);
    if (sourceId) sourceDriftCount.set(sourceId, (sourceDriftCount.get(sourceId) ?? 0) + count);
  }

  let stale = 0;
  for (const source of sources.results ?? []) {
    const manualRow =
      source.staleness_marked_by
        ? await env.DB.prepare(
            `SELECT staleness_score FROM knowledge_source WHERE id = ? AND workspace_id = ?`,
          )
            .bind(source.id, workspaceId)
            .first<{ staleness_score: number }>()
        : null;
    const manual =
      source.staleness_marked_by && manualRow ? manualRow.staleness_score : 0;
    const age = ageStalenessComponent(source.last_crawled_at, now);
    const driftCount = sourceDriftCount.get(source.id) ?? 0;
    // Drift component caps at MAX_DRIFT_BUMP.
    const drift = Math.min(MAX_DRIFT_BUMP, driftCount * 0.1);
    const components: StalenessComponents = { age, drift, manual };
    const score = combineStalenessComponents(components);
    if (score >= STALE_THRESHOLD) stale += 1;
    await env.DB.prepare(
      `UPDATE knowledge_source
          SET staleness_score = ?, staleness_components_json = ?, staleness_updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
      .bind(score, JSON.stringify(components), now, source.id, workspaceId)
      .run();
  }
  return { examined: sources.results?.length ?? 0, stale };
}

export async function computeKnowledgeHealth(
  env: Env,
  workspaceId: string,
  options: { now?: number } = {},
): Promise<KnowledgeHealth> {
  const now = options.now ?? Date.now();
  const rows = await env.DB.prepare(
    `SELECT staleness_score FROM knowledge_source WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .all<{ staleness_score: number }>();
  const scores = (rows.results ?? []).map((r) => r.staleness_score ?? 0);
  const total = scores.length;
  const average = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
  const stale = scores.filter((s) => s >= STALE_THRESHOLD).length;
  const topStale = await env.DB.prepare(
    `SELECT id, title, staleness_score, last_crawled_at FROM knowledge_source
       WHERE workspace_id = ? AND staleness_score >= ?
       ORDER BY staleness_score DESC LIMIT 5`,
  )
    .bind(workspaceId, STALE_THRESHOLD)
    .all<{ id: string; title: string; staleness_score: number; last_crawled_at: number | null }>();
  // Stale + cited recently is the high-severity bucket.
  const recentWindow = now - 30 * 24 * 60 * 60_000;
  const recent = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ks.id) AS n
       FROM knowledge_source ks
       JOIN knowledge_chunk kc ON kc.source_id = ks.id
       JOIN audit_event ae ON ae.workspace_id = ks.workspace_id
      WHERE ks.workspace_id = ? AND ks.staleness_score >= ?
        AND ae.action IN ('reply.sent','reply.auto_sent') AND ae.created_at >= ?
        AND json_extract(ae.payload_json, '$.citesKnowledgeIds') LIKE '%' || kc.id || '%'`,
  )
    .bind(workspaceId, STALE_THRESHOLD, recentWindow)
    .first<{ n: number }>();

  return {
    averageStaleness: average,
    staleSourceCount: stale,
    totalSourceCount: total,
    staleCitedRecently: recent?.n ?? 0,
    grade: gradeFromAverage(average),
    topStaleSources: topStale.results ?? [],
  };
}

function gradeFromAverage(avg: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (avg < 0.15) return 'A';
  if (avg < 0.3) return 'B';
  if (avg < 0.5) return 'C';
  if (avg < 0.7) return 'D';
  return 'F';
}

export async function markSourceStale(
  env: Env,
  input: { workspaceId: string; sourceId: string; score: number; reason?: string; actorUserId: string },
): Promise<void> {
  const now = Date.now();
  const score = Math.max(0, Math.min(1, input.score));
  await env.DB.prepare(
    `UPDATE knowledge_source
        SET staleness_score = ?,
            staleness_components_json = ?,
            staleness_updated_at = ?,
            staleness_marked_by = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      score,
      JSON.stringify({ age: 0, drift: 0, manual: score, reason: input.reason ?? null }),
      now,
      input.actorUserId,
      input.sourceId,
      input.workspaceId,
    )
    .run();
}
