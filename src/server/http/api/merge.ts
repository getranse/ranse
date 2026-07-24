import type { Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../../../lib/errors';
import { mergeTickets } from '../../actions/merge';
import { CAN_WORK_TICKETS, type Ctx, requireWorkspaceRole } from './context';

const mergeBody = z.object({ sourceTicketId: z.string().min(1) });

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
