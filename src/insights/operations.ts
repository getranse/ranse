import type { Env } from '../env';

// Operations dashboard. Aggregates the metrics that day-to-day support
// managers actually look at: resolution rate, AI deflection rate, time-
// to-first-response, time-to-resolution, customer satisfaction, ticket
// volume by channel. All derived from existing tables — no new ingest
// pipeline. Computed on demand; for very large workspaces a future
// enhancement can roll these into the existing weekly maintenance job.

export interface OperationsMetrics {
  windowStart: number;
  windowEnd: number;
  volume: { total: number; byChannel: { kind: string; count: number }[] };
  resolution: {
    rate: number; // resolved / total
    autonomousRate: number; // resolved_autonomously / resolved
    procedureRate: number; // resolved_via_procedure / resolved
  };
  deflection: {
    rate: number; // tickets without a human reply / total resolved
    autonomousResolved: number;
    humanResolved: number;
  };
  responseTime: {
    ttfrMedianMs: number | null;
    ttfrP90Ms: number | null;
    ttrMedianMs: number | null;
    ttrP90Ms: number | null;
  };
  satisfaction: {
    csatScore: number | null; // -1..+1 (positive - negative) / total
    positiveCount: number;
    negativeCount: number;
  };
  followUpRate: number;
}

const DEFAULT_WINDOW_DAYS = 30;

export async function computeOperationsMetrics(
  env: Env,
  workspaceId: string,
  options: { windowDays?: number } = {},
): Promise<OperationsMetrics> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60_000;

  const volume = await loadVolume(env, workspaceId, windowStart, now);
  const resolution = await loadResolutionMix(env, workspaceId, windowStart, now);
  const deflection = await loadDeflection(env, workspaceId, windowStart, now);
  const responseTime = await loadResponseTime(env, workspaceId, windowStart, now);
  const satisfaction = await loadSatisfaction(env, workspaceId, windowStart, now);
  const followUpRate = await loadFollowUpRate(env, workspaceId, windowStart, now);

  return {
    windowStart,
    windowEnd: now,
    volume,
    resolution,
    deflection,
    responseTime,
    satisfaction,
    followUpRate,
  };
}

async function loadVolume(env: Env, workspaceId: string, since: number, until: number) {
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ticket
       WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?`,
  )
    .bind(workspaceId, since, until)
    .first<{ total: number }>();
  const byChannel = await env.DB.prepare(
    `SELECT origin_channel_kind AS kind, COUNT(*) AS count
       FROM ticket
      WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY origin_channel_kind
      ORDER BY count DESC`,
  )
    .bind(workspaceId, since, until)
    .all<{ kind: string; count: number }>();
  return {
    total: totalRow?.total ?? 0,
    byChannel: byChannel.results ?? [],
  };
}

async function loadResolutionMix(env: Env, workspaceId: string, since: number, until: number) {
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'resolved' OR status = 'closed' THEN 1 ELSE 0 END) AS resolved,
       COUNT(*) AS total
     FROM ticket
     WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?`,
  )
    .bind(workspaceId, since, until)
    .first<{ resolved: number; total: number }>();
  const outcomes = await env.DB.prepare(
    `SELECT kind, COUNT(*) AS count FROM ticket_outcome_event
       WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY kind`,
  )
    .bind(workspaceId, since, until)
    .all<{ kind: string; count: number }>();
  const counts = Object.fromEntries(
    (outcomes.results ?? []).map((r) => [r.kind, r.count] as const),
  );
  const total = row?.total ?? 0;
  const resolved = row?.resolved ?? 0;
  const auto = counts.resolved_autonomously ?? 0;
  const proc = counts.resolved_via_procedure ?? 0;
  return {
    rate: total ? resolved / total : 0,
    autonomousRate: resolved ? auto / resolved : 0,
    procedureRate: resolved ? proc / resolved : 0,
  };
}

async function loadDeflection(env: Env, workspaceId: string, since: number, until: number) {
  // Deflection = tickets resolved without any outbound message authored by
  // a human user. We treat author_user_id IS NULL as "system/agent reply".
  const rows = await env.DB.prepare(
    `SELECT t.id,
            (SELECT COUNT(*) FROM message_index m
               WHERE m.ticket_id = t.id AND m.direction = 'outbound'
                 AND m.author_user_id IS NOT NULL) AS human_replies
       FROM ticket t
      WHERE t.workspace_id = ? AND t.created_at >= ? AND t.created_at <= ?
        AND t.status IN ('resolved','closed')`,
  )
    .bind(workspaceId, since, until)
    .all<{ id: string; human_replies: number }>();
  const total = rows.results?.length ?? 0;
  const autonomous = (rows.results ?? []).filter((r) => r.human_replies === 0).length;
  return {
    rate: total ? autonomous / total : 0,
    autonomousResolved: autonomous,
    humanResolved: total - autonomous,
  };
}

async function loadResponseTime(env: Env, workspaceId: string, since: number, until: number) {
  const rows = await env.DB.prepare(
    `SELECT t.created_at,
            (SELECT MIN(sent_at) FROM message_index
              WHERE ticket_id = t.id AND direction = 'outbound') AS first_resp,
            (SELECT MAX(created_at) FROM audit_event
              WHERE ticket_id = t.id AND action = 'reply.sent') AS last_resp
       FROM ticket t
      WHERE t.workspace_id = ? AND t.created_at >= ? AND t.created_at <= ?`,
  )
    .bind(workspaceId, since, until)
    .all<{ created_at: number; first_resp: number | null; last_resp: number | null }>();
  const ttfrs: number[] = [];
  const ttrs: number[] = [];
  for (const r of rows.results ?? []) {
    if (r.first_resp) ttfrs.push(r.first_resp - r.created_at);
    if (r.last_resp) ttrs.push(r.last_resp - r.created_at);
  }
  return {
    ttfrMedianMs: percentile(ttfrs, 50),
    ttfrP90Ms: percentile(ttfrs, 90),
    ttrMedianMs: percentile(ttrs, 50),
    ttrP90Ms: percentile(ttrs, 90),
  };
}

async function loadSatisfaction(env: Env, workspaceId: string, since: number, until: number) {
  const rows = await env.DB.prepare(
    `SELECT rating, COUNT(*) AS count FROM ticket_feedback
       WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY rating`,
  )
    .bind(workspaceId, since, until)
    .all<{ rating: string; count: number }>();
  const counts = Object.fromEntries((rows.results ?? []).map((r) => [r.rating, r.count] as const));
  const pos = counts.positive ?? 0;
  const neg = counts.negative ?? 0;
  const total = pos + neg;
  return {
    csatScore: total ? (pos - neg) / total : null,
    positiveCount: pos,
    negativeCount: neg,
  };
}

async function loadFollowUpRate(env: Env, workspaceId: string, since: number, until: number) {
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ticket
       WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?`,
  )
    .bind(workspaceId, since, until)
    .first<{ n: number }>();
  if (!total?.n) return 0;
  const followUps = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ticket_id) AS n FROM ticket_outcome_event
       WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?
         AND kind = 'customer_followed_up'`,
  )
    .bind(workspaceId, since, until)
    .first<{ n: number }>();
  return (followUps?.n ?? 0) / total.n;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
