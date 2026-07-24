import type { Hono } from 'hono';
import { apiError } from '../../../../lib/errors';
import { createMacro, deleteMacro, listMacros, updateMacro } from '../../../actions/macros';
import { createMacroBody, updateMacroBody } from '../../../schemas/macros';
import { CAN_WORK_TICKETS, type Ctx, requireWorkspaceRole } from '../context';

export function registerMacroRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/macros', async (c) => {
    const s = c.get('session');
    return c.json({ macros: await listMacros(c.env, s.workspaceId) });
  });

  apiApp.post('/macros', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = createMacroBody.parse(await c.req.json());
    return c.json({ macro: await createMacro(c.env, s.workspaceId, body.name, body.body) });
  });

  apiApp.put('/macros/:id', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = updateMacroBody.parse(await c.req.json());
    const ok = await updateMacro(c.env, s.workspaceId, c.req.param('id'), body);
    if (!ok) return apiError(c, 'not_found', 'That canned response does not exist.');
    return c.json({ ok: true });
  });

  apiApp.delete('/macros/:id', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    await deleteMacro(c.env, s.workspaceId, c.req.param('id'));
    return c.json({ ok: true });
  });
}
