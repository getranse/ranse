import { getAgentByName } from 'agents';
import type { Hono, MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { getSession } from '../lib/auth';
import { apiError } from '../lib/errors';
import { getMembershipRole, hasWorkspaceRole } from '../lib/workspaces';
import type { WorkspaceRole } from '../types/workspace';

export interface AuthedSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

export type Ctx = { Bindings: Env; Variables: { session: AuthedSession } };

export const OWNER_OR_ADMIN: WorkspaceRole[] = ['owner', 'admin'];
export const CAN_WORK_TICKETS: WorkspaceRole[] = ['owner', 'admin', 'agent'];

export function getSupervisor(env: Env, workspaceId: string) {
  // Cast to the SDK's expected `Agent<Cloudflare.Env>` shape. The namespace
  // binding is correct; only our custom Env generic differs.
  return getAgentByName(env.WorkspaceSupervisorAgent as never, workspaceId);
}

export function installApiAuth(apiApp: Hono<Ctx>) {
  apiApp.use('*', async (c, next) => {
    const s = await getSession(c);
    if (!s?.workspaceId) return apiError(c, 'unauthorized', 'Sign in required.');
    const role = await getMembershipRole(c.env, s.userId, s.workspaceId);
    if (!role) return apiError(c, 'unauthorized', 'Select an active workspace.');
    c.set('session', { sessionId: s.sessionId, userId: s.userId, workspaceId: s.workspaceId, role });
    await next();
  });
}

export function requireWorkspaceRole(allowed: readonly WorkspaceRole[]): MiddlewareHandler<Ctx> {
  return async (c, next) => {
    const { role } = c.get('session');
    if (!hasWorkspaceRole(role, allowed)) {
      return apiError(c, 'forbidden', 'Your workspace role does not allow that action.');
    }
    await next();
  };
}
