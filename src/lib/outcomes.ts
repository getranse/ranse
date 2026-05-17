import type { Env } from '../env';
import { audit } from './audit';
import { ids } from './ids';
import type {
  FeedbackRating,
  FeedbackSource,
  OutcomeKind,
  OutcomeSource,
  TicketFeedback,
  TicketOutcomeEvent,
  WorkspaceOutcomeDaily,
} from '../types/autonomy';

export async function recordOutcome(
  env: Env,
  input: {
    workspaceId: string;
    ticketId: string;
    kind: OutcomeKind;
    source: OutcomeSource;
    confidenceScore?: number | null;
    payload?: Record<string, unknown>;
  },
): Promise<string> {
  const id = ids.outcome();
  await env.DB.prepare(
    `INSERT INTO ticket_outcome_event (
       id, workspace_id, ticket_id, kind, source, confidence_score, payload_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.ticketId,
      input.kind,
      input.source,
      input.confidenceScore ?? null,
      JSON.stringify(input.payload ?? {}),
      Date.now(),
    )
    .run();
  await incrementRollup(env, input.workspaceId, rollupColumnForOutcome(input.kind), 1);
  return id;
}

export async function listTicketOutcomes(
  env: Env,
  workspaceId: string,
  ticketId: string,
  limit = 50,
): Promise<TicketOutcomeEvent[]> {
  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, ticket_id, kind, source, confidence_score, payload_json, created_at
       FROM ticket_outcome_event
      WHERE workspace_id = ? AND ticket_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, ticketId, Math.min(Math.max(limit, 1), 200))
    .all<TicketOutcomeEvent>();
  return rows.results ?? [];
}

export async function listTicketFeedback(
  env: Env,
  workspaceId: string,
  ticketId: string,
  limit = 50,
): Promise<TicketFeedback[]> {
  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, ticket_id, message_id, rating, source, comment, created_at
       FROM ticket_feedback
      WHERE workspace_id = ? AND ticket_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, ticketId, Math.min(Math.max(limit, 1), 200))
    .all<TicketFeedback>();
  return rows.results ?? [];
}

export async function recordTicketFeedback(
  env: Env,
  input: {
    workspaceId: string;
    ticketId: string;
    actorUserId?: string;
    messageId?: string | null;
    rating: FeedbackRating;
    source?: FeedbackSource;
    comment?: string | null;
  },
): Promise<string> {
  const id = ids.feedback();
  await env.DB.prepare(
    `INSERT INTO ticket_feedback (
       id, workspace_id, ticket_id, message_id, rating, source, comment, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.ticketId,
      input.messageId ?? null,
      input.rating,
      input.source ?? 'agent',
      input.comment ?? null,
      Date.now(),
    )
    .run();
  await incrementRollup(env, input.workspaceId, rollupColumnForFeedback(input.rating), 1);
  await audit(env, {
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    actorType: input.actorUserId ? 'user' : 'system',
    actorId: input.actorUserId,
    action: 'ticket.feedback_recorded',
    payload: { feedbackId: id, rating: input.rating, source: input.source ?? 'agent' },
  });
  return id;
}

export async function recordCustomerFeedback(
  env: Env,
  input: {
    workspaceId: string;
    ticketId: string;
    messageId: string;
    rating: FeedbackRating;
  },
): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT id, rating FROM ticket_feedback
      WHERE workspace_id = ? AND ticket_id = ? AND message_id = ? AND source = 'customer'
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(input.workspaceId, input.ticketId, input.messageId)
    .first<{ id: string; rating: FeedbackRating }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE ticket_feedback SET rating = ?, created_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
      .bind(input.rating, Date.now(), existing.id, input.workspaceId)
      .run();
    if (existing.rating !== input.rating) {
      await incrementRollup(env, input.workspaceId, rollupColumnForFeedback(existing.rating), -1);
      await incrementRollup(env, input.workspaceId, rollupColumnForFeedback(input.rating), 1);
    }
    await audit(env, {
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      actorType: 'system',
      action: 'ticket.feedback_recorded',
      payload: { feedbackId: existing.id, rating: input.rating, source: 'customer' },
    });
    return existing.id;
  }

  return recordTicketFeedback(env, {
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    messageId: input.messageId,
    rating: input.rating,
    source: 'customer',
  });
}

export async function listWorkspaceOutcomeRollups(
  env: Env,
  workspaceId: string,
  days = 30,
): Promise<WorkspaceOutcomeDaily[]> {
  const rows = await env.DB.prepare(
    `SELECT workspace_id, day, resolved_autonomously_count, resolved_via_procedure_count,
            escalated_count, customer_followed_up_count, positive_feedback_count,
            negative_feedback_count, updated_at
       FROM workspace_outcome_daily
      WHERE workspace_id = ?
      ORDER BY day DESC
      LIMIT ?`,
  )
    .bind(workspaceId, Math.min(Math.max(days, 1), 365))
    .all<WorkspaceOutcomeDaily>();
  return rows.results ?? [];
}

type RollupColumn =
  | 'resolved_autonomously_count'
  | 'resolved_via_procedure_count'
  | 'escalated_count'
  | 'customer_followed_up_count'
  | 'positive_feedback_count'
  | 'negative_feedback_count';

async function incrementRollup(env: Env, workspaceId: string, column: RollupColumn, delta: number) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (delta < 0) {
    await env.DB.prepare(
      `UPDATE workspace_outcome_daily
          SET ${column} = max(0, ${column} + ?), updated_at = ?
        WHERE workspace_id = ? AND day = ?`,
    )
      .bind(delta, now, workspaceId, day)
      .run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO workspace_outcome_daily (workspace_id, day, ${column}, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, day) DO UPDATE SET
       ${column} = max(0, ${column} + excluded.${column}),
       updated_at = excluded.updated_at`,
  )
    .bind(workspaceId, day, delta, now)
    .run();
}

function rollupColumnForOutcome(kind: OutcomeKind): RollupColumn {
  return `${kind}_count` as RollupColumn;
}

function rollupColumnForFeedback(rating: FeedbackRating): RollupColumn {
  return rating === 'positive' ? 'positive_feedback_count' : 'negative_feedback_count';
}
