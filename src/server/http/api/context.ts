import type { AuthedSession } from '../../../interfaces/http';

export type { AuthedSession };

import { getAgentByName } from 'agents';
import type { Hono, MiddlewareHandler } from 'hono';
import { apiError } from '../../../lib/errors';
import type { WorkspaceRole } from '../../../types/shared/workspaces';
import { resolveApiToken } from '../../actions/api-tokens';
import { getSession } from '../../actions/auth';
import type { Env } from '../../env';
import { getMembershipRole, hasWorkspaceRole } from '../../platform/workspaces';

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
    // Programmatic access: `Authorization: Bearer ranse_…` maps to a synthetic
    // session bounded by the token's stored role. Cookie sessions otherwise.
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (bearer?.startsWith('ranse_')) {
      const token = await resolveApiToken(c.env, bearer);
      if (!token) return apiError(c, 'unauthorized', 'Invalid or revoked API token.');
      c.set('session', {
        sessionId: `api:${token.tokenId}`,
        userId: `api:${token.tokenId}`,
        workspaceId: token.workspaceId,
        role: token.role,
      });
      return next();
    }
    const s = await getSession(c);
    if (!s?.workspaceId) return apiError(c, 'unauthorized', 'Sign in required.');
    const role = await getMembershipRole(c.env, s.userId, s.workspaceId);
    if (!role) return apiError(c, 'unauthorized', 'Select an active workspace.');
    c.set('session', {
      sessionId: s.sessionId,
      userId: s.userId,
      workspaceId: s.workspaceId,
      role,
    });
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
