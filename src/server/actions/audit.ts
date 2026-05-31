import type { AuditContext, AuditInput } from '../../interfaces/lib';
export type { AuditContext, AuditInput };
import type { Context } from 'hono';
import { auditMeta, } from '../../types/shared/audit';
import type { Env } from '../env';
import { ids } from '../../lib/ids';
import { chainPayload, sha256Hex } from '../../lib/crypto';

/**
 * Append an audit event. Beyond the raw action it: derives category/severity from
 * the catalog, snapshots the actor's identity (so a later user delete doesn't erase
 * "who"), records request context, and extends a per-workspace tamper-evident
 * SHA-256 hash chain (each row hashes the previous row's hash + its own fields).
 */
export async function audit(env: Env, input: AuditInput): Promise<void> {
  const now = Date.now();
  const id = ids.audit();
  const { category, severity } = auditMeta(input.action);
  const payloadJson = JSON.stringify(input.payload ?? {});

  let actorEmail = input.context?.actorEmail ?? null;
  let actorName = input.context?.actorName ?? null;
  if (input.actorType === 'user' && input.actorId && !actorEmail) {
    const user = await env.DB.prepare('SELECT email, name FROM user WHERE id = ?')
      .bind(input.actorId)
      .first<{ email: string; name: string | null }>()
      .catch(() => null);
    if (user) {
      actorEmail = user.email;
      actorName = user.name ?? null;
    }
  }

  const prev = await env.DB.prepare(
    'SELECT hash FROM audit_event WHERE workspace_id = ? ORDER BY rowid DESC LIMIT 1',
  )
    .bind(input.workspaceId)
    .first<{ hash: string | null }>()
    .catch(() => null);
  const prevHash = prev?.hash ?? null;
  const hash = await sha256Hex(
    chainPayload([
      prevHash,
      id,
      input.workspaceId,
      input.ticketId ?? null,
      input.actorType,
      input.actorId ?? null,
      input.action,
      payloadJson,
      String(now),
    ]),
  );

  await env.DB.prepare(
    `INSERT INTO audit_event
       (id, workspace_id, ticket_id, actor_type, actor_id, actor_email, actor_name,
        action, category, severity, ip, user_agent, request_id, payload_json,
        prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.ticketId ?? null,
      input.actorType,
      input.actorId ?? null,
      actorEmail,
      actorName,
      input.action,
      category,
      severity,
      input.context?.ip ?? null,
      input.context?.userAgent ?? null,
      input.context?.requestId ?? null,
      payloadJson,
      prevHash,
      hash,
      now,
    )
    .run();
}

/** Recompute the chain for a workspace and report the first row whose hash doesn't verify. */
export async function verifyAuditChain(
  env: Env,
  workspaceId: string,
): Promise<{ ok: boolean; checked: number; brokenAt?: string }> {
  const rows = await env.DB.prepare(
    `SELECT id, ticket_id, actor_type, actor_id, action, payload_json, created_at, prev_hash, hash
       FROM audit_event WHERE workspace_id = ? ORDER BY rowid ASC`,
  )
    .bind(workspaceId)
    .all<{
      id: string;
      ticket_id: string | null;
      actor_type: string;
      actor_id: string | null;
      action: string;
      payload_json: string;
      created_at: number;
      prev_hash: string | null;
      hash: string | null;
    }>();
  let prevHash: string | null = null;
  let checked = 0;
  let first = true;
  for (const r of rows.results ?? []) {
    // Seed from the first remaining row's prev_hash so retention (purging an old
    // prefix) doesn't read as tampering — the retained suffix is still verified.
    if (first) {
      prevHash = r.prev_hash ?? null;
      first = false;
    }
    if ((r.prev_hash ?? null) !== prevHash) return { ok: false, checked, brokenAt: r.id };
    const expected = await sha256Hex(
      chainPayload([
        prevHash,
        r.id,
        workspaceId,
        r.ticket_id,
        r.actor_type,
        r.actor_id,
        r.action,
        r.payload_json,
        String(r.created_at),
      ]),
    );
    if (expected !== r.hash) return { ok: false, checked, brokenAt: r.id };
    prevHash = r.hash;
    checked += 1;
  }
  return { ok: true, checked };
}

/**
 * Whether PII read-access logging is enabled for a workspace (the
 * `audit_read_logging` setting). Off by default — read logging is high-volume.
 */
export async function isReadLoggingEnabled(env: Env, workspaceId: string): Promise<boolean> {
  const w = await env.DB.prepare('SELECT settings_json FROM workspace WHERE id = ?')
    .bind(workspaceId)
    .first<{ settings_json: string }>()
    .catch(() => null);
  if (!w) return false;
  try {
    return !!(JSON.parse(w.settings_json || '{}') as { audit_read_logging?: boolean }).audit_read_logging;
  } catch {
    return false;
  }
}

/** Extract request metadata for an audited HTTP action. Actor identity is resolved in audit(). */
export function auditContext(c: Context): AuditContext {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ip:
      c.req.header('cf-connecting-ip') ??
      (forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null),
    userAgent: c.req.header('user-agent') ?? null,
    requestId: c.req.header('x-request-id') ?? crypto.randomUUID(),
  };
}

/** Field-level before/after diff for mutation audits. Only changed keys are returned. */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: string[],
): Record<string, { from: unknown; to: unknown }> {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return changes;
}
