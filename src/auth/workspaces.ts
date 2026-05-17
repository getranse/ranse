import type { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { apiError } from '../lib/errors';
import { getSession } from '../lib/auth';
import { acceptWorkspaceInvitation, createWorkspaceForUser, switchSessionWorkspace } from '../lib/workspaces';

export function registerAuthWorkspaceRoutes(authApp: Hono<{ Bindings: Env }>) {
  authApp.post('/workspaces', async (c) => {
    const session = await getSession(c);
    if (!session) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = z.object({ name: z.string().min(1).max(100) }).parse(await c.req.json());
    const workspace = await createWorkspaceForUser(c.env, session.userId, body.name);
    await switchSessionWorkspace(c.env, session.sessionId, session.userId, workspace.id);
    return c.json({ ok: true, workspaceId: workspace.id, workspace });
  });

  authApp.post('/workspaces/switch', async (c) => {
    const session = await getSession(c);
    if (!session) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = z.object({ workspace_id: z.string().min(1) }).parse(await c.req.json());
    const workspace = await switchSessionWorkspace(c.env, session.sessionId, session.userId, body.workspace_id);
    if (!workspace) return apiError(c, 'forbidden', 'You are not a member of that workspace.');
    return c.json({ ok: true, workspaceId: workspace.id, workspace });
  });

  authApp.post('/invitations/accept', async (c) => {
    const session = await getSession(c);
    if (!session) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = z.object({ token: z.string().min(20) }).parse(await c.req.json());
    const workspace = await acceptWorkspaceInvitation(c.env, session.userId, body.token);
    if (!workspace) return apiError(c, 'not_found', 'Invitation is invalid, expired, or for another user.');
    await switchSessionWorkspace(c.env, session.sessionId, session.userId, workspace.id);
    return c.json({ ok: true, workspaceId: workspace.id, workspace });
  });
}
