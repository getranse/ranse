import type { InboundEmailPayload } from '../../../../types/shared/supervisor';
import { autoAssignNewTicket } from '../../../actions/team-assignment';
import { insertTicketRow } from '../../../actions/tickets';
import type { Env } from '../../../env';

export async function createTicket(
  env: Env,
  workspaceId: string,
  payload: InboundEmailPayload,
  now: number,
): Promise<string> {
  const ticketId = await insertTicketRow(env, workspaceId, payload, now);
  await autoAssignNewTicket(env, workspaceId, ticketId, payload.mailboxId);
  return ticketId;
}
