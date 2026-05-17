import type { Env } from '../env';
import { audit } from './audit';
import { randomToken } from './crypto';
import { ids } from './ids';
import type { WorkspaceAuditEvent, WorkspaceMailbox, WorkspaceUsage } from '../types/workspace';

export async function listWorkspaceMailboxes(env: Env, workspaceId: string): Promise<WorkspaceMailbox[]> {
  const rows = await env.DB.prepare(
    `SELECT id, address, display_name, auto_reply_policy, created_at
       FROM mailbox
      WHERE workspace_id = ?
      ORDER BY created_at ASC`,
  ).bind(workspaceId).all<WorkspaceMailbox>();
  return rows.results ?? [];
}

export async function createWorkspaceMailbox(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  input: { address: string; displayName?: string | null; autoReplyPolicy?: string },
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
    auto_reply_policy: input.autoReplyPolicy ?? 'safe',
    created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO mailbox (id, workspace_id, address, display_name, reply_signing_secret, auto_reply_policy, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(mailbox.id, workspaceId, mailbox.address, mailbox.display_name, randomToken(32), mailbox.auto_reply_policy, now).run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'mailbox.created',
    payload: { mailboxId: mailbox.id, address: mailbox.address },
  });
  return mailbox;
}

export async function updateWorkspaceMailbox(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  mailboxId: string,
  input: { displayName?: string | null; autoReplyPolicy?: string },
): Promise<'ok' | 'not_found'> {
  const existing = await env.DB.prepare(`SELECT id FROM mailbox WHERE id = ? AND workspace_id = ?`)
    .bind(mailboxId, workspaceId)
    .first<{ id: string }>();
  if (!existing) return 'not_found';
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
  if (updates.length > 0) {
    await env.DB.prepare(`UPDATE mailbox SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`)
      .bind(...binds, mailboxId, workspaceId)
      .run();
  }
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'mailbox.updated',
    payload: { mailboxId },
  });
  return 'ok';
}

export async function workspaceUsage(env: Env, workspaceId: string): Promise<WorkspaceUsage> {
  const count = async (sql: string) => {
    const row = await env.DB.prepare(sql).bind(workspaceId).first<{ n: number }>();
    return row?.n ?? 0;
  };
  const [members, mailboxes, tickets, openTickets, messages, knowledgeSources, notificationChannels, llmConfigs, auditEvents] =
    await Promise.all([
      count(`SELECT COUNT(*) AS n FROM workspace_user WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM mailbox WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM ticket WHERE workspace_id = ? AND status IN ('open','pending')`),
      count(`SELECT COUNT(*) AS n FROM message_index WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM knowledge_source WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM notification_channel WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM workspace_llm_config WHERE workspace_id = ?`),
      count(`SELECT COUNT(*) AS n FROM audit_event WHERE workspace_id = ?`),
    ]);
  return { members, mailboxes, tickets, openTickets, messages, knowledgeSources, notificationChannels, llmConfigs, auditEvents };
}

export async function workspaceAuditLog(env: Env, workspaceId: string, limit: number): Promise<WorkspaceAuditEvent[]> {
  const rows = await env.DB.prepare(
    `SELECT id, ticket_id, actor_type, actor_id, action, payload_json, created_at
       FROM audit_event
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  ).bind(workspaceId, limit).all<WorkspaceAuditEvent>();
  return rows.results ?? [];
}

export async function workspaceExportManifest(env: Env, workspaceId: string) {
  const workspace = await env.DB.prepare(
    `SELECT id, name, slug, settings_json, created_at, updated_at, archived_at, deleted_at
       FROM workspace WHERE id = ?`,
  ).bind(workspaceId).first();
  return {
    exportedAt: Date.now(),
    policy: {
      format: 'json_manifest',
      deletion: 'soft_delete_retains_workspace_data_until_operator_purge',
      archive: 'hidden_from_active_sessions_and_workspace_picker',
    },
    workspace,
    usage: await workspaceUsage(env, workspaceId),
    members: await env.DB.prepare(`SELECT workspace_id, user_id, role, created_at FROM workspace_user WHERE workspace_id = ?`)
      .bind(workspaceId).all().then((r) => r.results ?? []),
    mailboxes: await listWorkspaceMailboxes(env, workspaceId),
    audit: await workspaceAuditLog(env, workspaceId, 500),
  };
}
