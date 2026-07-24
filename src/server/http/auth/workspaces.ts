import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import { getSession } from '../../actions/auth';
import type { Env } from '../../env';
import {
  acceptWorkspaceInvitation,
  createWorkspaceForUser,
  switchSessionWorkspace,
} from '../../platform/workspaces';
import {
  acceptInvitationBody,
  createWorkspaceBody,
  switchWorkspaceBody,
} from '../../schemas/auth-workspaces';

export function registerAuthWorkspaceRoutes(authApp: Hono<{ Bindings: Env }>) {
  authApp.post('/workspaces', async (c) => {
    const session = await getSession(c);
    if (!session) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = createWorkspaceBody.parse(await c.req.json());
    const workspace = await createWorkspaceForUser(c.env, session.userId, body.name);
    await switchSessionWorkspace(c.env, session.sessionId, session.userId, workspace.id);
    return c.json({ ok: true, workspaceId: workspace.id, workspace });
  });

  authApp.post('/workspaces/switch', async (c) => {
    const session = await getSession(c);
    if (!session) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = switchWorkspaceBody.parse(await c.req.json());
    const workspace = await switchSessionWorkspace(
      c.env,
      session.sessionId,
      session.userId,
      body.workspace_id,
    );
    if (!workspace) return apiError(c, 'forbidden', 'You are not a member of that workspace.');
    return c.json({ ok: true, workspaceId: workspace.id, workspace });
  });

  authApp.post('/invitations/accept', async (c) => {
    const session = await getSession(c);
    if (!session) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = acceptInvitationBody.parse(await c.req.json());
    const workspace = await acceptWorkspaceInvitation(c.env, session.userId, body.token);
    if (!workspace)
      return apiError(c, 'not_found', 'Invitation is invalid, expired, or for another user.');
    await switchSessionWorkspace(c.env, session.sessionId, session.userId, workspace.id);
    return c.json({ ok: true, workspaceId: workspace.id, workspace });
  });
}
