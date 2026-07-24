import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import {
  createTag,
  deleteTag,
  listTags,
  listTicketTags,
  tagTicket,
  untagTicket,
} from '../../actions/tags';
import { assignTagBody, createTagBody } from '../../schemas/tags';
import { CAN_WORK_TICKETS, type Ctx, requireWorkspaceRole } from './context';

export function registerTagRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/tags', async (c) => {
    const s = c.get('session');
    return c.json({ tags: await listTags(c.env, s.workspaceId) });
  });

  apiApp.post('/tags', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = createTagBody.parse(await c.req.json());
    return c.json({ tag: await createTag(c.env, s.workspaceId, body.name, body.color) });
  });

  apiApp.delete('/tags/:id', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    await deleteTag(c.env, s.workspaceId, c.req.param('id'));
    return c.json({ ok: true });
  });

  apiApp.get('/tickets/:id/tags', async (c) => {
    const s = c.get('session');
    return c.json({ tags: await listTicketTags(c.env, s.workspaceId, c.req.param('id')) });
  });

  apiApp.post('/tickets/:id/tags', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = assignTagBody.parse(await c.req.json());
    const ok = await tagTicket(c.env, s.workspaceId, c.req.param('id'), body.tagId);
    if (!ok) return apiError(c, 'not_found', 'Ticket or tag not found in this workspace.');
    return c.json({ ok: true });
  });

  apiApp.delete('/tickets/:id/tags/:tagId', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    await untagTicket(c.env, s.workspaceId, c.req.param('id'), c.req.param('tagId'));
    return c.json({ ok: true });
  });
}
