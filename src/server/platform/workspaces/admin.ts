import type { Env } from '../../env';
import { listPublicChannels } from '../../inbox/channels';
import { audit, diffChanges } from '../../actions/audit';
import { randomToken } from '../../../lib/crypto';
import { ids } from '../../../lib/ids';
import { listWorkspaceOutcomeRollups } from '../outcomes';
import type { WorkspaceMailbox, WorkspaceUsage } from '../../../types/shared/workspace';
import type { AuditEventRecord, AuditQuery } from '../../../types/shared/audit';
import {
  type AutonomyPolicy,
  DEFAULT_AUTONOMY_THRESHOLD,
  legacyAutoReplyPolicy,
  normalizeAutonomyPolicy,
  normalizeAutonomyRolloutPercent,
  normalizeAutonomyThreshold,
} from '../../../types/shared/autonomy';

export async function listWorkspaceMailboxes(
  env: Env,
  workspaceId: string,
): Promise<WorkspaceMailbox[]> {
  const rows = await env.DB.prepare(
    `SELECT id, address, display_name, auto_reply_policy, autonomy_policy,
            autonomy_threshold, autonomy_rollout_percent, created_at
       FROM mailbox
      WHERE workspace_id = ?
      ORDER BY created_at ASC`,
  )
    .bind(workspaceId)
    .all<WorkspaceMailbox>();
  return rows.results ?? [];
}

export async function createWorkspaceMailbox(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  input: {
    address: string;
    displayName?: string | null;
    autoReplyPolicy?: string;
    autonomyPolicy?: AutonomyPolicy;
    autonomyThreshold?: number;
    autonomyRolloutPercent?: number;
  },
): Promise<WorkspaceMailbox> {
  const now = Date.now();
  const existing = await env.DB.prepare(`SELECT id FROM mailbox WHERE address = ?`)
    .bind(input.address.toLowerCase())
    .first<{ id: string }>();
  if (existing) throw new Error('mailbox_address_already_exists');
  const mailbox = {
    id: ids.mailbox(),
    address: input.address.toLowerCase(),
    display_name: input.displayName ?? null,
    autonomy_policy: normalizeAutonomyPolicy(input.autonomyPolicy ?? input.autoReplyPolicy),
    autonomy_threshold: normalizeAutonomyThreshold(
      input.autonomyThreshold ?? DEFAULT_AUTONOMY_THRESHOLD,
    ),
    autonomy_rollout_percent: normalizeAutonomyRolloutPercent(input.autonomyRolloutPercent),
    created_at: now,
  };
  const autoReplyPolicy = input.autoReplyPolicy ?? legacyAutoReplyPolicy(mailbox.autonomy_policy);
  const result = { ...mailbox, auto_reply_policy: autoReplyPolicy };
  await env.DB.prepare(
    `INSERT INTO mailbox (
       id, workspace_id, address, display_name, reply_signing_secret, auto_reply_policy,
       autonomy_policy, autonomy_threshold, autonomy_rollout_percent, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      mailbox.id,
      workspaceId,
      mailbox.address,
      mailbox.display_name,
      randomToken(32),
      autoReplyPolicy,
      mailbox.autonomy_policy,
      mailbox.autonomy_threshold,
      mailbox.autonomy_rollout_percent,
      now,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'mailbox.created',
    payload: { mailboxId: mailbox.id, address: mailbox.address },
  });
  return result;
}

export async function updateWorkspaceMailbox(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  mailboxId: string,
  input: {
    displayName?: string | null;
    autoReplyPolicy?: string;
    autonomyPolicy?: AutonomyPolicy;
    autonomyThreshold?: number;
    autonomyRolloutPercent?: number;
  },
): Promise<'ok' | 'not_found'> {
  const mailboxFields = `display_name, auto_reply_policy, autonomy_policy, autonomy_threshold, autonomy_rollout_percent`;
  const before = await env.DB.prepare(
    `SELECT ${mailboxFields} FROM mailbox WHERE id = ? AND workspace_id = ?`,
  )
    .bind(mailboxId, workspaceId)
    .first<Record<string, unknown>>();
  if (!before) return 'not_found';
  const updates: string[] = [];
  const binds: unknown[] = [];
  if (input.displayName !== undefined) {
    updates.push('display_name = ?');
    binds.push(input.displayName);
  }
  if (input.autoReplyPolicy !== undefined) {
    updates.push('auto_reply_policy = ?');
    binds.push(input.autoReplyPolicy);
  }
  if (input.autonomyPolicy !== undefined) {
    updates.push('autonomy_policy = ?');
    updates.push('auto_reply_policy = ?');
    binds.push(input.autonomyPolicy, legacyAutoReplyPolicy(input.autonomyPolicy));
  }
  if (input.autonomyThreshold !== undefined) {
    updates.push('autonomy_threshold = ?');
    binds.push(normalizeAutonomyThreshold(input.autonomyThreshold));
  }
  if (input.autonomyRolloutPercent !== undefined) {
    updates.push('autonomy_rollout_percent = ?');
    binds.push(normalizeAutonomyRolloutPercent(input.autonomyRolloutPercent));
  }
  if (updates.length > 0) {
    await env.DB.prepare(
      `UPDATE mailbox SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...binds, mailboxId, workspaceId)
      .run();
  }
  const after = updates.length
    ? await env.DB.prepare(
        `SELECT ${mailboxFields} FROM mailbox WHERE id = ? AND workspace_id = ?`,
      )
        .bind(mailboxId, workspaceId)
        .first<Record<string, unknown>>()
    : before;
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'mailbox.updated',
    payload: { mailboxId, changes: diffChanges(before, after ?? {}) },
  });
  return 'ok';
}

export async function workspaceUsage(env: Env, workspaceId: string): Promise<WorkspaceUsage> {
  const count = async (sql: string) => {
    const row = await env.DB.prepare(sql).bind(workspaceId).first<{ n: number }>();
    return row?.n ?? 0;
  };
  const [
    members,
    mailboxes,
    tickets,
    openTickets,
    messages,
    knowledgeSources,
    notificationChannels,
    publicChannels,
    llmConfigs,
    auditEvents,
  ] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM workspace_user WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM mailbox WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ?`),
    count(
      `SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ? AND status IN ('open','pending')`,
    ),
    count(`SELECT COUNT(*) AS n FROM message_index WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM knowledge_source WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM notification_channel WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM public_channel WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM workspace_llm_config WHERE workspace_id = ?`),
    count(`SELECT COUNT(*) AS n FROM audit_event WHERE workspace_id = ?`),
  ]);
  return {
    members,
    mailboxes,
    tickets,
    openTickets,
    messages,
    knowledgeSources,
    notificationChannels,
    publicChannels,
    llmConfigs,
    auditEvents,
  };
}

export async function workspaceAuditLog(
  env: Env,
  workspaceId: string,
  query: AuditQuery = {},
): Promise<AuditEventRecord[]> {
  const conditions = ['workspace_id = ?'];
  const params: unknown[] = [workspaceId];
  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  if (query.category) {
    conditions.push('category = ?');
    params.push(query.category);
  }
  if (query.actorId) {
    conditions.push('actor_id = ?');
    params.push(query.actorId);
  }
  if (query.ticketId) {
    conditions.push('ticket_id = ?');
    params.push(query.ticketId);
  }
  if (query.from) {
    conditions.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('created_at <= ?');
    params.push(query.to);
  }
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 1000);
  params.push(limit);
  const rows = await env.DB.prepare(
    `SELECT id, ticket_id, actor_type, actor_id, actor_email, actor_name, action, category,
            severity, ip, user_agent, request_id, payload_json, prev_hash, hash, created_at
       FROM audit_event
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
  )
    .bind(...params)
    .all<AuditEventRecord>();
  return rows.results ?? [];
}

export async function workspaceExportManifest(env: Env, workspaceId: string) {
  const workspace = await env.DB.prepare(
    `SELECT id, name, slug, settings_json, created_at, updated_at, archived_at, deleted_at
       FROM workspace WHERE id = ?`,
  )
    .bind(workspaceId)
    .first();
  return {
    exportedAt: Date.now(),
    policy: {
      format: 'json_manifest',
      deletion: 'soft_delete_retains_workspace_data_until_operator_purge',
      archive: 'hidden_from_active_sessions_and_workspace_picker',
    },
    workspace,
    usage: await workspaceUsage(env, workspaceId),
    members: await env.DB.prepare(
      `SELECT workspace_id, user_id, role, created_at FROM workspace_user WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .all()
      .then((r) => r.results ?? []),
    mailboxes: await listWorkspaceMailboxes(env, workspaceId),
    publicChannels: await listPublicChannels(env, workspaceId),
    outcomeRollups: await listWorkspaceOutcomeRollups(env, workspaceId, 365),
    audit: await workspaceAuditLog(env, workspaceId, { limit: 500 }),
  };
}
