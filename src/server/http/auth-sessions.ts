import type { Hono } from 'hono';
import { apiError } from '../../lib/errors';
import { getSession, revokeOtherSessions } from '../actions/auth';
import type { Env } from '../env';
import { auditUserEvent } from './auth-guards';

export function registerSessionRoutes(authApp: Hono<{ Bindings: Env }>) {
  // Sign out everywhere else: revoke all of the user's sessions except the one
  // making the request. The natural place `auth.session_revoked` is emitted —
  // a security-hygiene action a user takes when they suspect a stale or
  // compromised session elsewhere.
  authApp.post('/sessions/revoke-others', async (c) => {
    const s = await getSession(c);
    if (!s) return apiError(c, 'unauthorized', 'Sign in required.');
    const revoked = await revokeOtherSessions(c.env, s.userId, s.sessionId);
    await auditUserEvent(c, s.userId, undefined, 'auth.session_revoked', {
      scope: 'others',
      revoked,
    });
    return c.json({ ok: true, revoked });
  });
}
