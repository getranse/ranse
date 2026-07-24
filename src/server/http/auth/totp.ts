import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import { generateTotpSecret, totpUri, verifyTotp } from '../../../lib/totp';
import { getSession } from '../../actions/auth';
import { clearTotp, enableTotp, loadUserTotp, saveTotpSecret } from '../../actions/users';
import type { Env } from '../../env';
import { totpCodeBody } from '../../schemas/auth';
import { auditUserEvent } from './guards';

export function registerTotpRoutes(authApp: Hono<{ Bindings: Env }>) {
  // Step 1: provision a secret. 2FA does not enforce until step 2 confirms
  // the authenticator produces valid codes — a half-done setup must never
  // lock the account.
  authApp.post('/totp/setup', async (c) => {
    const s = await getSession(c);
    if (!s) return apiError(c, 'unauthorized', 'Sign in required.');
    const user = await loadUserTotp(c.env, s.userId);
    if (!user) return apiError(c, 'unauthorized', 'Sign in required.');
    if (user.totp_enabled) return apiError(c, 'conflict', 'Two-factor auth is already enabled.');
    const secret = generateTotpSecret();
    await saveTotpSecret(c.env, s.userId, secret);
    return c.json({ secret, uri: totpUri(secret, user.email) });
  });

  authApp.post('/totp/verify', async (c) => {
    const s = await getSession(c);
    if (!s) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = totpCodeBody.parse(await c.req.json());
    const user = await loadUserTotp(c.env, s.userId);
    if (!user?.totp_secret) return apiError(c, 'conflict', 'Run two-factor setup first.');
    if (!(await verifyTotp(user.totp_secret, body.code))) {
      return apiError(
        c,
        'invalid_code',
        'That code is not valid. Check your authenticator app.',
        400,
      );
    }
    await enableTotp(c.env, s.userId);
    await auditUserEvent(c, s.userId, undefined, 'auth.totp_enabled');
    return c.json({ ok: true });
  });

  authApp.post('/totp/disable', async (c) => {
    const s = await getSession(c);
    if (!s) return apiError(c, 'unauthorized', 'Sign in required.');
    const body = totpCodeBody.parse(await c.req.json());
    const user = await loadUserTotp(c.env, s.userId);
    if (!user?.totp_enabled || !user.totp_secret) return c.json({ ok: true });
    if (!(await verifyTotp(user.totp_secret, body.code))) {
      return apiError(
        c,
        'invalid_code',
        'A valid code is required to disable two-factor auth.',
        400,
      );
    }
    await clearTotp(c.env, s.userId);
    await auditUserEvent(c, s.userId, undefined, 'auth.totp_disabled');
    return c.json({ ok: true });
  });
}
