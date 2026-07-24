import { ids } from '../../lib/ids';
import type { InboundEmailPayload } from '../../types/shared/supervisor';
import type { Env } from '../env';
import type { TriageResult } from '../schemas/triage';

/** Insert the ticket row for a first-contact inbound email; returns its id. */
export async function insertTicketRow(
  env: Env,
  workspaceId: string,
  payload: InboundEmailPayload,
  now: number,
): Promise<string> {
  const ticketId = ids.ticket();
  await env.DB.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, requester_email,
       requester_name, last_message_at, thread_token, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ticketId,
      workspaceId,
      payload.mailboxId,
      payload.subject,
      payload.from.address.toLowerCase(),
      payload.from.name ?? null,
      payload.receivedAt,
      ids.ticket().slice(4),
      now,
      now,
    )
    .run();
  return ticketId;
}

export async function setTriageFields(
  env: Env,
  workspaceId: string,
  ticketId: string,
  triage: TriageResult,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE ticket SET category = ?, priority = ?, sentiment = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(triage.category, triage.priority, triage.sentiment, Date.now(), ticketId, workspaceId)
    .run();
}

export async function markTicketSpam(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE ticket SET status = 'spam' WHERE id = ? AND workspace_id = ?`)
    .bind(ticketId, workspaceId)
    .run();
}
