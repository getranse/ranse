import type { PortalMessage, PortalTicketView } from '../../interfaces/portal';
import type { Env } from '../env';

/**
 * Customer-facing view of one ticket. Internal notes are excluded at the
 * query level — they must never reach the portal, whatever the renderer does.
 */
export async function loadPortalTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<PortalTicketView | null> {
  const ticket = await env.DB.prepare(
    `SELECT t.subject, t.status, w.name AS workspace_name
       FROM ticket t JOIN workspace w ON w.id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?`,
  )
    .bind(ticketId, workspaceId)
    .first<{ subject: string; status: string; workspace_name: string }>();
  if (!ticket) return null;

  const messages = await env.DB.prepare(
    `SELECT direction, preview, sent_at FROM message_index
      WHERE ticket_id = ? AND workspace_id = ? AND direction IN ('inbound', 'outbound')
      ORDER BY sent_at ASC
      LIMIT 200`,
  )
    .bind(ticketId, workspaceId)
    .all<PortalMessage>();

  return { ...ticket, messages: messages.results ?? [] };
}
