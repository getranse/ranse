import { audit } from '../../actions/audit';
import type { Env } from '../../env';

/**
 * Attach a 1–5 survey score (and optional comment) to the customer's latest
 * thumbs feedback on a message. Returns false when no feedback row exists —
 * the survey step only ever follows a recorded thumbs click.
 */
export async function recordFeedbackSurvey(
  env: Env,
  input: {
    workspaceId: string;
    ticketId: string;
    messageId: string;
    score: number;
    comment?: string;
  },
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `SELECT id FROM ticket_feedback
      WHERE workspace_id = ? AND ticket_id = ? AND message_id = ? AND source = 'customer'
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(input.workspaceId, input.ticketId, input.messageId)
    .first<{ id: string }>();
  if (!existing) return false;

  await env.DB.prepare(
    `UPDATE ticket_feedback SET score = ?, comment = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(input.score, input.comment?.trim() || null, existing.id, input.workspaceId)
    .run();
  await audit(env, {
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    actorType: 'system',
    action: 'ticket.feedback_recorded',
    payload: { feedbackId: existing.id, score: input.score, source: 'customer_survey' },
  });
  return true;
}
