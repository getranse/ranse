import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { deleteSession, getSession } from '../actions/auth';
import { getUserBasics } from '../actions/users';
import type { Env } from '../env';
import { listUserWorkspaces } from '../platform/workspaces';
import { auditUserEvent } from './auth-guards';
import { registerLoginRoute } from './auth-login';
import { registerSessionRoutes } from './auth-sessions';
import { registerTotpRoutes } from './auth-totp';
import { registerAuthWorkspaceRoutes } from './auth-workspaces';

export const authApp = new Hono<{ Bindings: Env }>();

registerLoginRoute(authApp);

authApp.post('/logout', async (c) => {
  const s = await getSession(c);
  if (s) {
    await deleteSession(c.env, s.sessionId);
    await auditUserEvent(c, s.userId, undefined, 'auth.logout');
  }
  deleteCookie(c, 'ranse_session', { path: '/' });
  return c.json({ ok: true });
});

authApp.get('/me', async (c) => {
  const s = await getSession(c);
  if (!s) return c.json({ authenticated: false });
  const user = await getUserBasics(c.env, s.userId);
  const workspaces = await listUserWorkspaces(c.env, s.userId);
  const current = workspaces.some((w) => w.id === s.workspaceId) ? s.workspaceId : undefined;
  return c.json({ authenticated: true, user, workspaces, currentWorkspaceId: current });
});

registerSessionRoutes(authApp);
registerTotpRoutes(authApp);
registerAuthWorkspaceRoutes(authApp);
