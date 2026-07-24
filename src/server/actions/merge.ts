import type { Env } from '../env';
import { audit } from './audit';

/**
 * Merge one ticket's conversation into another: messages, tags, pending
 * approvals, and the search index move to the target; the source closes with
 * an audit trail on both sides. Historical audit/outcome rows stay on the
 * source — they describe what happened to that ticket, not the target.
 */
export async function mergeTickets(
  env: Env,
  workspaceId: string,
  targetId: string,
  sourceId: string,
  actorUserId: string,
): Promise<'ok' | 'not_found' | 'invalid'> {
  if (targetId === sourceId) return 'invalid';
  const rows = await env.DB.prepare(
    `SELECT id, status, last_message_at FROM ticket WHERE workspace_id = ? AND id IN (?, ?)`,
  )
    .bind(workspaceId, targetId, sourceId)
    .all<{ id: string; status: string; last_message_at: number }>();
  const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));
  const target = byId.get(targetId);
  const source = byId.get(sourceId);
  if (!target || !source) return 'not_found';

  const moves = [
    `UPDATE message_index SET ticket_id = ?1 WHERE workspace_id = ?3 AND ticket_id = ?2`,
    `UPDATE message_fts SET ticket_id = ?1 WHERE workspace_id = ?3 AND ticket_id = ?2`,
    `UPDATE OR IGNORE ticket_tag SET ticket_id = ?1 WHERE workspace_id = ?3 AND ticket_id = ?2`,
    `DELETE FROM ticket_tag WHERE workspace_id = ?3 AND ticket_id = ?2`,
    `UPDATE approval_request SET ticket_id = ?1 WHERE workspace_id = ?3 AND ticket_id = ?2 AND status = 'pending'`,
  ];
  for (const sql of moves) {
    await env.DB.prepare(sql).bind(targetId, sourceId, workspaceId).run();
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE ticket SET status = 'closed', updated_at = ? WHERE workspace_id = ? AND id = ?`,
  )
    .bind(now, workspaceId, sourceId)
    .run();
  await env.DB.prepare(
    `UPDATE ticket SET last_message_at = MAX(last_message_at, ?), updated_at = ?
      WHERE workspace_id = ? AND id = ?`,
  )
    .bind(source.last_message_at, now, workspaceId, targetId)
    .run();

  const context = { actorUserId };
  await audit(env, {
    workspaceId,
    ticketId: targetId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'ticket.merged',
    payload: { ...context, direction: 'absorbed', otherTicketId: sourceId },
  });
  await audit(env, {
    workspaceId,
    ticketId: sourceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'ticket.merged',
    payload: { ...context, direction: 'merged_into', otherTicketId: targetId },
  });
  return 'ok';
}
