import { getAgentByName } from 'agents';
import type { Hono } from 'hono';
import type { Env } from '../env';
import { getSession } from '../lib/auth';
import { apiError } from '../lib/errors';

export interface AuthedSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
}

export type Ctx = { Bindings: Env; Variables: { session: AuthedSession } };

export function getSupervisor(env: Env, workspaceId: string) {
  // Cast to the SDK's expected `Agent<Cloudflare.Env>` shape. The namespace
  // binding is correct; only our custom Env generic differs.
  return getAgentByName(env.WorkspaceSupervisorAgent as never, workspaceId);
}

export function installApiAuth(apiApp: Hono<Ctx>) {
  apiApp.use('*', async (c, next) => {
    const s = await getSession(c);
    if (!s?.workspaceId) return apiError(c, 'unauthorized', 'Sign in required.');
    c.set('session', { sessionId: s.sessionId, userId: s.userId, workspaceId: s.workspaceId });
    await next();
  });
}
