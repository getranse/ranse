import type { Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../../../lib/errors';
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeams,
  removeTeamMember,
} from '../../actions/teams';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

const createTeamBody = z.object({ name: z.string().min(1).max(64) });
const memberBody = z.object({ userId: z.string().min(1) });

export function registerTeamRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/teams', async (c) => {
    const s = c.get('session');
    return c.json({ teams: await listTeams(c.env, s.workspaceId) });
  });

  apiApp.post('/teams', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = createTeamBody.parse(await c.req.json());
    return c.json({ team: await createTeam(c.env, s.workspaceId, body.name) });
  });

  apiApp.delete('/teams/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    await deleteTeam(c.env, s.workspaceId, c.req.param('id'));
    return c.json({ ok: true });
  });

  apiApp.post('/teams/:id/members', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = memberBody.parse(await c.req.json());
    const ok = await addTeamMember(c.env, s.workspaceId, c.req.param('id'), body.userId);
    if (!ok) return apiError(c, 'not_found', 'Team or user not found in this workspace.');
    return c.json({ ok: true });
  });

  apiApp.delete('/teams/:id/members/:userId', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    await removeTeamMember(c.env, s.workspaceId, c.req.param('id'), c.req.param('userId'));
    return c.json({ ok: true });
  });
}
