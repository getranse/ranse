import { SOFT_BOUNCE_SUPPRESS_AFTER } from '../../config/channels';
import type { BounceInfo } from '../../interfaces/email';
import { ids } from '../../lib/ids';
import type { Env } from '../env';
import { audit } from './audit';

/**
 * Record an inbound bounce: resolve the failed recipient (falling back to the
 * ticket requester when the DSN omits it), upsert the suppression row, and
 * audit the event. Returns the suppressed address, or null when no recipient
 * could be determined.
 */
export async function processInboundBounce(
  env: Env,
  args: { workspaceId: string; ticketId: string | null; bounce: BounceInfo },
): Promise<string | null> {
  let address = args.bounce.recipient;
  if (!address && args.ticketId) {
    const row = await env.DB.prepare(
      `SELECT requester_email FROM ticket WHERE id = ? AND workspace_id = ?`,
    )
      .bind(args.ticketId, args.workspaceId)
      .first<{ requester_email: string }>();
    address = row?.requester_email?.toLowerCase() ?? null;
  }
  if (!address) return null;

  const now = Date.now();
  const reason = args.bounce.kind === 'hard' ? 'hard_bounce' : 'soft_bounce';
  await env.DB.prepare(
    `INSERT INTO email_suppression (id, workspace_id, address, reason, status_code, ticket_id, bounce_count, last_bounce_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (workspace_id, address) DO UPDATE SET
       bounce_count = bounce_count + 1,
       reason = CASE WHEN excluded.reason = 'hard_bounce' THEN 'hard_bounce' ELSE email_suppression.reason END,
       status_code = COALESCE(excluded.status_code, email_suppression.status_code),
       ticket_id = COALESCE(excluded.ticket_id, email_suppression.ticket_id),
       last_bounce_at = excluded.last_bounce_at`,
  )
    .bind(
      ids.message(),
      args.workspaceId,
      address,
      reason,
      args.bounce.status,
      args.ticketId,
      now,
      now,
    )
    .run();

  await audit(env, {
    workspaceId: args.workspaceId,
    ticketId: args.ticketId ?? undefined,
    actorType: 'system',
    actorId: 'email',
    action: 'email.bounced',
    payload: { address, kind: args.bounce.kind, status: args.bounce.status },
  });
  return address;
}

/** True when AI auto-send to this address must be blocked. */
export async function isEmailSuppressed(
  env: Env,
  workspaceId: string,
  address: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT reason, bounce_count FROM email_suppression WHERE workspace_id = ? AND address = ?`,
  )
    .bind(workspaceId, address.toLowerCase())
    .first<{ reason: string; bounce_count: number }>();
  if (!row) return false;
  return row.reason === 'hard_bounce' || row.bounce_count >= SOFT_BOUNCE_SUPPRESS_AFTER;
}

/** Suppression check keyed by the ticket's requester address. */
export async function isTicketRequesterSuppressed(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT requester_email FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(ticketId, workspaceId)
    .first<{ requester_email: string }>();
  if (!row?.requester_email) return false;
  return isEmailSuppressed(env, workspaceId, row.requester_email);
}
