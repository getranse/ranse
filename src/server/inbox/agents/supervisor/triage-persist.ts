import { audit } from '../../../actions/audit';
import type { Env } from '../../../env';
import type { TriageResult } from '../../../schemas/triage';

export async function persistTriage(
  env: Env,
  workspaceId: string,
  ticketId: string,
  triage: TriageResult,
) {
  await env.DB.prepare(
    `UPDATE ticket SET category = ?, priority = ?, sentiment = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(triage.category, triage.priority, triage.sentiment, Date.now(), ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'triage',
    action: 'ticket.triaged',
    payload: triage as any,
  });
}

export async function markSpam(env: Env, workspaceId: string, ticketId: string) {
  await env.DB.prepare(`UPDATE ticket SET status = 'spam' WHERE id = ? AND workspace_id = ?`)
    .bind(ticketId, workspaceId)
    .run();
}
