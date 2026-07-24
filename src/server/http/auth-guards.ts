import type { Context } from 'hono';
import { apiError } from '../../lib/errors';
import type { AuditAction } from '../../types/shared/audit';
import { audit, auditContext } from '../actions/audit';
import type { Env } from '../env';
import { listUserWorkspaces } from '../platform/workspaces';

type AuthCtx = Context<{ Bindings: Env }>;

// Auth events are user-scoped but the audit log is workspace-scoped, so we record
// the event under every workspace the user can access — each workspace's admins
// then see their own members' logins/failures.
export async function auditUserEvent(
  c: AuthCtx,
  userId: string,
  email: string | undefined,
  action: AuditAction,
  payload?: Record<string, unknown>,
) {
  const workspaces = await listUserWorkspaces(c.env, userId).catch(() => []);
  const context = { ...auditContext(c), actorEmail: email ?? null };
  await Promise.all(
    workspaces.map((w) =>
      audit(c.env, {
        workspaceId: w.id,
        actorType: 'user',
        actorId: userId,
        action,
        payload,
        context,
      }),
    ),
  );
}

// Brute-force guard: credential attempts are throttled per client IP and per
// target account, so a distributed guess against one mailbox is capped too.
export async function checkLoginRateLimit(c: AuthCtx, email: string): Promise<Response | null> {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const results = await Promise.all(
    [`login:ip:${ip}`, `login:email:${email.toLowerCase()}`].map((key) =>
      c.env.RATE_LIMIT_AUTH?.limit({ key }).catch(() => ({ success: true })),
    ),
  );
  return results.some((r) => r && !r.success)
    ? apiError(c, 'rate_limited', 'Too many sign-in attempts. Try again in a minute.', 429)
    : null;
}
