import { audit } from '../../../actions/audit';
import { markTicketSpam, setTriageFields } from '../../../actions/tickets';
import type { Env } from '../../../env';
import type { TriageResult } from '../../../schemas/triage';

export async function persistTriage(
  env: Env,
  workspaceId: string,
  ticketId: string,
  triage: TriageResult,
) {
  await setTriageFields(env, workspaceId, ticketId, triage);
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'triage',
    action: 'ticket.triaged',
    payload: { ...triage },
  });
}

export const markSpam = markTicketSpam;
