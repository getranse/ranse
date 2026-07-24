import { ids } from '../../../../lib/ids';
import type { InboundEmailPayload } from '../../../../types/shared/supervisor';
import { autoAssignNewTicket } from '../../../actions/team-assignment';
import type { Env } from '../../../env';

export async function createTicket(
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
  await autoAssignNewTicket(env, workspaceId, ticketId, payload.mailboxId);
  return ticketId;
}
