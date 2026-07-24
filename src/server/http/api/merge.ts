import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import { mergeTickets } from '../../actions/merge';
import { mergeBody } from '../../schemas/tickets';
import { CAN_WORK_TICKETS, type Ctx, requireWorkspaceRole } from './context';

export function registerMergeRoutes(apiApp: Hono<Ctx>) {
  // Merges the source ticket INTO :id — the open conversation continues on :id.
  apiApp.post('/tickets/:id/merge', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = mergeBody.parse(await c.req.json());
    const result = await mergeTickets(
      c.env,
      s.workspaceId,
      c.req.param('id'),
      body.sourceTicketId,
      s.userId,
    );
    if (result === 'not_found') return apiError(c, 'not_found', 'Ticket not found.');
    if (result === 'invalid') return apiError(c, 'conflict', 'A ticket cannot merge into itself.');
    return c.json({ ok: true });
  });
}
