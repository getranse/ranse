import type { Env } from '../env';
import { audit } from '../lib/audit';
import { ids } from '../lib/ids';
import { recordLedgerEntry } from '../billing/outcomes';
import {
  type HonestResolutionMetrics,
  VERIFICATION_WINDOW_MS,
  type VerifiedResolutionRejectionReason,
  type VerifiedResolutionRow,
  type VerifiedResolutionSource,
} from '../../types/honest-resolution';

// Honest Resolution — the verified_resolution lifecycle.
//
// An AI-authored reply (autonomous or procedure) opens a 7-day verification
// window. Anything that contradicts a clean resolution — a human takeover,
// an escalation, a customer follow-up, or a negative feedback signal — moves
// the row to `rejected` with a reason. After the window closes with no
// rejection, the sweeper promotes it to `verified`.
//
// One row per ticket. A re-opened ticket needs another AI reply to start a
// new window (the UNIQUE constraint enforces this and the enqueue path is a
// no-op when a row already exists).

export interface EnqueueArgs {
  workspaceId: string;
  ticketId: string;
  aiMessageId: string;
  source: VerifiedResolutionSource;
  authoredAt?: number;
  payload?: Record<string, unknown>;
}

export async function enqueueVerification(env: Env, args: EnqueueArgs): Promise<string | null> {
  const now = args.authoredAt ?? Date.now();
  const windowCloses = now + VERIFICATION_WINDOW_MS;
  const id = ids.verifiedResolution();
  // INSERT OR IGNORE preserves the first AI message for the ticket. A second
  // AI reply on the same ticket (e.g. a follow-up procedure step) does not
  // re-open the window — the original message is what we're attesting to.
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO verified_resolution (
       id, workspace_id, ticket_id, ai_message_id, ai_authored_at,
       window_closes_at, status, source, payload_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      args.workspaceId,
      args.ticketId,
      args.aiMessageId,
      now,
      windowCloses,
      args.source,
      args.payload ? JSON.stringify(args.payload) : null,
      now,
      now,
    )
    .run();
  if (result.meta?.changes === 0) return null;
  return id;
}

export async function rejectVerification(
  env: Env,
  workspaceId: string,
  ticketId: string,
  reason: VerifiedResolutionRejectionReason,
  payload?: Record<string, unknown>,
): Promise<boolean> {
  const now = Date.now();
  // Only reject rows still pending — once verified we don't retroactively
  // overturn the metric, and once rejected we don't overwrite the reason.
  const result = await env.DB.prepare(
    `UPDATE verified_resolution
        SET status = 'rejected',
            rejection_reason = ?,
            updated_at = ?,
            payload_json = COALESCE(?, payload_json)
      WHERE workspace_id = ? AND ticket_id = ? AND status = 'pending'`,
  )
    .bind(
      reason,
      now,
      payload ? JSON.stringify(payload) : null,
      workspaceId,
      ticketId,
    )
    .run();
  const changed = (result.meta?.changes ?? 0) > 0;
  if (changed) {
    await audit(env, {
      workspaceId,
      ticketId,
      actorType: 'system',
      action: 'honest_resolution.rejected',
      payload: { reason, ...(payload ?? {}) },
    });
  }
  return changed;
}

export interface SweepResult {
  examined: number;
  verified: number;
}

export async function sweepDueVerifications(
  env: Env,
  options: { now?: number; limit?: number } = {},
): Promise<SweepResult> {
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
  const due = await env.DB.prepare(
    `SELECT id, workspace_id, ticket_id
       FROM verified_resolution
      WHERE status = 'pending' AND window_closes_at <= ?
      ORDER BY window_closes_at ASC
      LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ id: string; workspace_id: string; ticket_id: string }>();
  const rows = due.results ?? [];
  let verified = 0;
  for (const row of rows) {
    const upd = await env.DB.prepare(
      `UPDATE verified_resolution
          SET status = 'verified', verified_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
      .bind(now, now, row.id)
      .run();
    if ((upd.meta?.changes ?? 0) > 0) {
      verified += 1;
      await audit(env, {
        workspaceId: row.workspace_id,
        ticketId: row.ticket_id,
        actorType: 'system',
        action: 'honest_resolution.verified',
        payload: { id: row.id },
      });
      // The verified-resolution price-book entry is the "outcome we actually
      // wanted" — recorded here so the ledger reflects net value, not just
      // the provisional autonomous/procedure resolution credit we wrote at
      // outcome-event time.
      await recordLedgerEntry(env, {
        workspaceId: row.workspace_id,
        ticketId: row.ticket_id,
        kind: 'verified_resolution',
        metadata: { verifiedResolutionId: row.id },
      }).catch((err) => console.warn('failed to record verified-resolution ledger entry', err));
    }
  }
  return { examined: rows.length, verified };
}

export async function getVerifiedResolution(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<VerifiedResolutionRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, workspace_id, ticket_id, ai_message_id, ai_authored_at,
            window_closes_at, status, rejection_reason, verified_at, source,
            payload_json, created_at, updated_at
       FROM verified_resolution
      WHERE workspace_id = ? AND ticket_id = ?`,
  )
    .bind(workspaceId, ticketId)
    .first<VerifiedResolutionRow>();
  return row ?? null;
}

export async function computeHonestResolutionMetrics(
  env: Env,
  workspaceId: string,
  options: { windowDays?: number; now?: number } = {},
): Promise<HonestResolutionMetrics> {
  const windowDays = Math.min(Math.max(options.windowDays ?? 30, 1), 365);
  const now = options.now ?? Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60_000;

  const rows = await env.DB.prepare(
    `SELECT status, rejection_reason, COUNT(*) AS count
       FROM verified_resolution
      WHERE workspace_id = ? AND ai_authored_at >= ? AND ai_authored_at <= ?
      GROUP BY status, rejection_reason`,
  )
    .bind(workspaceId, windowStart, now)
    .all<{ status: string; rejection_reason: string | null; count: number }>();

  const breakdown: Record<VerifiedResolutionRejectionReason, number> = {
    human_takeover: 0,
    escalated: 0,
    follow_up: 0,
    negative_feedback: 0,
    reopened: 0,
  };
  let verifiedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  for (const r of rows.results ?? []) {
    if (r.status === 'verified') verifiedCount += r.count;
    else if (r.status === 'pending') pendingCount += r.count;
    else if (r.status === 'rejected') {
      rejectedCount += r.count;
      const key = r.rejection_reason as VerifiedResolutionRejectionReason | null;
      if (key && key in breakdown) breakdown[key] += r.count;
    }
  }
  const aiAuthoredCount = verifiedCount + pendingCount + rejectedCount;
  const honestResolutionRate = aiAuthoredCount ? verifiedCount / aiAuthoredCount : 0;
  // Fin-style: AI replied, human did not "take over". Pending + verified count.
  // Rejections for follow_up / negative_feedback are still counted as resolved
  // in Fin's model — that's the whole reason this metric exists.
  const finStyleResolved =
    verifiedCount +
    pendingCount +
    breakdown.follow_up +
    breakdown.negative_feedback +
    breakdown.reopened;
  const finStyleRate = aiAuthoredCount ? finStyleResolved / aiAuthoredCount : 0;

  return {
    windowDays,
    windowStart,
    windowEnd: now,
    aiAuthoredCount,
    verifiedCount,
    pendingCount,
    rejectedCount,
    rejectionBreakdown: breakdown,
    honestResolutionRate,
    finStyleRate,
  };
}
