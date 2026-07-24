import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { apiError } from '../../lib/errors';
import { hashPassword, needsRehash } from '../../lib/password';
import { createSession, getSession, setSessionCookie, verifyPassword } from '../actions/auth';
import type { Env } from '../env';
import { listUserWorkspaces } from '../platform/workspaces';
import { auditUserEvent, checkLoginRateLimit } from './auth-guards';
import { registerAuthWorkspaceRoutes } from './auth-workspaces';

export const authApp = new Hono<{ Bindings: Env }>();

authApp.post('/login', async (c) => {
  const body = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .parse(await c.req.json());

  const limited = await checkLoginRateLimit(c, body.email);
  if (limited) return limited;

  const user = await c.env.DB.prepare(`SELECT id, password_hash FROM user WHERE email = ?`)
    .bind(body.email.toLowerCase())
    .first<{ id: string; password_hash: string | null }>();
  if (!user?.password_hash) {
    if (user)
      await auditUserEvent(c, user.id, body.email, 'auth.login_failed', { reason: 'no_password' });
    return apiError(c, 'invalid_credentials', 'Incorrect email or password.');
  }

  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    await auditUserEvent(c, user.id, body.email, 'auth.login_failed', { reason: 'bad_password' });
    return apiError(c, 'invalid_credentials', 'Incorrect email or password.');
  }

  if (needsRehash(user.password_hash)) {
    const fresh = await hashPassword(body.password);
    await c.env.DB.prepare(`UPDATE user SET password_hash = ? WHERE id = ?`)
      .bind(fresh, user.id)
      .run();
  }

  const workspaces = await listUserWorkspaces(c.env, user.id);
  const currentWorkspaceId = workspaces.length === 1 ? workspaces[0].id : undefined;
  const sessionId = await createSession(c.env, user.id, currentWorkspaceId);
  await setSessionCookie(c, sessionId);
  await c.env.DB.prepare(`UPDATE user SET last_login_at = ? WHERE id = ?`)
    .bind(Date.now(), user.id)
    .run();

  await auditUserEvent(c, user.id, body.email, 'auth.login');
  return c.json({ ok: true, userId: user.id, workspaceId: currentWorkspaceId });
});

authApp.post('/logout', async (c) => {
  const s = await getSession(c);
  if (s) {
    await c.env.DB.prepare(`DELETE FROM session WHERE id = ?`).bind(s.sessionId).run();
    await auditUserEvent(c, s.userId, undefined, 'auth.logout');
  }
  deleteCookie(c, 'ranse_session', { path: '/' });
  return c.json({ ok: true });
});

// Sign out everywhere else: revoke all of the user's sessions except the one
// making the request. The natural place `auth.session_revoked` is emitted —
// a security-hygiene action a user takes when they suspect a stale or
// compromised session elsewhere.
authApp.post('/sessions/revoke-others', async (c) => {
  const s = await getSession(c);
  if (!s) return apiError(c, 'unauthorized', 'Sign in required.');
  const result = await c.env.DB.prepare(`DELETE FROM session WHERE user_id = ? AND id != ?`)
    .bind(s.userId, s.sessionId)
    .run();
  const revoked = Number(result.meta?.changes ?? 0);
  await auditUserEvent(c, s.userId, undefined, 'auth.session_revoked', {
    scope: 'others',
    revoked,
  });
  return c.json({ ok: true, revoked });
});

authApp.get('/me', async (c) => {
  const s = await getSession(c);
  if (!s) return c.json({ authenticated: false });
  const user = await c.env.DB.prepare(`SELECT id, email, name FROM user WHERE id = ?`)
    .bind(s.userId)
    .first<{ id: string; email: string; name: string | null }>();
  const workspaces = await listUserWorkspaces(c.env, s.userId);
  const currentWorkspaceId = workspaces.some((w) => w.id === s.workspaceId)
    ? s.workspaceId
    : undefined;
  return c.json({
    authenticated: true,
    user,
    workspaces,
    currentWorkspaceId,
  });
});

registerAuthWorkspaceRoutes(authApp);
