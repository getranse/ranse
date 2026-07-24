import type { Hono } from 'hono';
import { apiError } from '../../lib/errors';
import { hashPassword, needsRehash } from '../../lib/password';
import { verifyTotp } from '../../lib/totp';
import { createSession, setSessionCookie, verifyPassword } from '../actions/auth';
import { findLoginUser, touchLastLogin, updatePasswordHash } from '../actions/users';
import type { Env } from '../env';
import { listUserWorkspaces } from '../platform/workspaces';
import { loginBody } from '../schemas/auth';
import { auditUserEvent, checkLoginRateLimit } from './auth-guards';

export function registerLoginRoute(authApp: Hono<{ Bindings: Env }>) {
  authApp.post('/login', async (c) => {
    const body = loginBody.parse(await c.req.json());

    const limited = await checkLoginRateLimit(c, body.email);
    if (limited) return limited;

    const user = await findLoginUser(c.env, body.email);
    if (!user?.password_hash) {
      if (user)
        await auditUserEvent(c, user.id, body.email, 'auth.login_failed', {
          reason: 'no_password',
        });
      return apiError(c, 'invalid_credentials', 'Incorrect email or password.');
    }

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      await auditUserEvent(c, user.id, body.email, 'auth.login_failed', { reason: 'bad_password' });
      return apiError(c, 'invalid_credentials', 'Incorrect email or password.');
    }

    if (user.totp_enabled && user.totp_secret) {
      if (!body.totpCode) return apiError(c, 'totp_required', 'Enter your two-factor code.', 401);
      if (!(await verifyTotp(user.totp_secret, body.totpCode))) {
        await auditUserEvent(c, user.id, body.email, 'auth.login_failed', { reason: 'bad_totp' });
        return apiError(c, 'invalid_totp', 'That two-factor code is not valid.', 401);
      }
    }

    if (needsRehash(user.password_hash)) {
      await updatePasswordHash(c.env, user.id, await hashPassword(body.password));
    }

    const workspaces = await listUserWorkspaces(c.env, user.id);
    const currentWorkspaceId = workspaces.length === 1 ? workspaces[0].id : undefined;
    const sessionId = await createSession(c.env, user.id, currentWorkspaceId);
    await setSessionCookie(c, sessionId);
    await touchLastLogin(c.env, user.id);

    await auditUserEvent(c, user.id, body.email, 'auth.login');
    return c.json({ ok: true, userId: user.id, workspaceId: currentWorkspaceId });
  });
}
