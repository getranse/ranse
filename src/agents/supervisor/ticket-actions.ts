import type { Env } from '../../env';
import { audit } from '../../lib/audit';
import { ids } from '../../lib/ids';
import { r2Keys, putRaw } from '../../lib/storage';
import { recordKnowledgeUsage } from '../../knowledge';
import type { SendThreadedReply, TicketListItem } from '../../types/supervisor';

export { draftReply } from './ticket-draft';

export async function listTickets(
  env: Env,
  workspaceId: string,
  params: { status?: string; limit?: number; offset?: number },
): Promise<TicketListItem[]> {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const clause = params.status ? 'AND status = ?' : '';
  const bindings: any[] = [workspaceId];
  if (params.status) bindings.push(params.status);
  bindings.push(limit, offset);
  const rows = await env.DB.prepare(
    `SELECT id, subject, status, priority, requester_email, last_message_at, category, assignee_user_id
       FROM ticket WHERE workspace_id = ? ${clause}
       ORDER BY last_message_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings)
    .all<TicketListItem>();
  return rows.results ?? [];
}

export async function getTicket(env: Env, workspaceId: string, ticketId: string) {
  const ticket = await env.DB.prepare(`SELECT * FROM ticket WHERE id = ? AND workspace_id = ?`)
    .bind(ticketId, workspaceId)
    .first();
  if (!ticket) return null;
  const [messages, auditRows, approvals] = await Promise.all([
    env.DB.prepare(`SELECT * FROM message_index WHERE ticket_id = ? ORDER BY sent_at ASC`)
      .bind(ticketId)
      .all(),
    env.DB.prepare(
      `SELECT * FROM audit_event WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(ticketId)
      .all(),
    env.DB.prepare(`SELECT * FROM approval_request WHERE ticket_id = ? ORDER BY created_at DESC`)
      .bind(ticketId)
      .all(),
  ]);
  return {
    ticket,
    messages: messages.results ?? [],
    audit: auditRows.results ?? [],
    approvals: approvals.results ?? [],
  };
}

export async function assignTicket(
  env: Env,
  workspaceId: string,
  args: { ticketId: string; userId: string | null; actorUserId: string },
) {
  await env.DB.prepare(
    `UPDATE ticket SET assignee_user_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(args.userId, Date.now(), args.ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId: args.ticketId,
    actorType: 'user',
    actorId: args.actorUserId,
    action: args.userId ? 'ticket.assigned' : 'ticket.unassigned',
    payload: { userId: args.userId },
  });
}

export async function setTicketStatus(
  env: Env,
  workspaceId: string,
  args: {
    ticketId: string;
    status: 'open' | 'pending' | 'resolved' | 'closed' | 'spam';
    actorUserId: string;
  },
  refreshCounts: () => Promise<void>,
) {
  await env.DB.prepare(
    `UPDATE ticket SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(args.status, Date.now(), args.ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId: args.ticketId,
    actorType: 'user',
    actorId: args.actorUserId,
    action: `ticket.${args.status}`,
  });
  await refreshCounts();
}

export async function addInternalNote(
  env: Env,
  workspaceId: string,
  args: { ticketId: string; body: string; actorUserId: string },
) {
  const messageId = ids.message();
  await env.DB.prepare(
    `INSERT INTO message_index (id, ticket_id, workspace_id, direction, preview, author_user_id, sent_at, created_at)
     VALUES (?, ?, ?, 'note', ?, ?, ?, ?)`,
  )
    .bind(
      messageId,
      args.ticketId,
      workspaceId,
      args.body.slice(0, 280),
      args.actorUserId,
      Date.now(),
      Date.now(),
    )
    .run();
  await putRaw(
    env,
    r2Keys.textBody(workspaceId, args.ticketId, messageId),
    new TextEncoder().encode(args.body),
    'text/plain; charset=utf-8',
  );
  await audit(env, {
    workspaceId,
    ticketId: args.ticketId,
    actorType: 'user',
    actorId: args.actorUserId,
    action: 'ticket.internal_note',
  });
}

export async function approveAndSend(
  env: Env,
  workspaceId: string,
  args: {
    approvalId: string;
    actorUserId: string;
    edits?: { subject?: string; body_markdown?: string };
  },
  sendThreadedReply: SendThreadedReply,
) {
  const row = await env.DB.prepare(
    `SELECT workspace_id, ticket_id, kind, proposed_json, status FROM approval_request WHERE id = ?`,
  )
    .bind(args.approvalId)
    .first<{
      workspace_id: string;
      ticket_id: string;
      kind: string;
      proposed_json: string;
      status: string;
    }>();
  if (!row || row.status !== 'pending') return { ok: false, error: 'not_pending' };
  if (row.workspace_id !== workspaceId) return { ok: false, error: 'wrong_workspace' };

  const proposed = JSON.parse(row.proposed_json);
  const sent = await sendThreadedReply({
    ticketId: row.ticket_id,
    body: args.edits?.body_markdown ?? proposed.body_markdown,
    subject: args.edits?.subject ?? proposed.subject,
    actorUserId: args.actorUserId,
    source: 'ai_approval',
    approvalId: args.approvalId,
    edited: !!args.edits,
  });
  await recordKnowledgeUsage(env, workspaceId, proposed.cites_knowledge_ids ?? []).catch((err) =>
    console.warn('failed to record knowledge usage', err),
  );
  await env.DB.prepare(
    `UPDATE approval_request SET status = 'approved', decided_by_user_id = ?, decided_at = ? WHERE id = ?`,
  )
    .bind(args.actorUserId, Date.now(), args.approvalId)
    .run();
  return { ok: true, messageId: sent.messageId };
}

export async function replyDirect(
  env: Env,
  workspaceId: string,
  args: {
    ticketId: string;
    actorUserId: string;
    body: string;
    subject?: string;
    citedKnowledgeIds?: string[];
  },
  sendThreadedReply: SendThreadedReply,
) {
  if (!args.body || args.body.trim().length === 0) return { ok: false, error: 'empty_body' };
  try {
    const sent = await sendThreadedReply({ ...args, source: 'manual' });
    await recordKnowledgeUsage(env, workspaceId, args.citedKnowledgeIds ?? []).catch((err) =>
      console.warn('failed to record knowledge usage', err),
    );
    return { ok: true, messageId: sent.messageId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'send_failed' };
  }
}

export async function setTicketAiDrafts(
  env: Env,
  workspaceId: string,
  args: {
    ticketId: string;
    actorUserId: string;
    enabled: boolean | null;
  },
) {
  const v = args.enabled === null ? null : args.enabled ? 1 : 0;
  await env.DB.prepare(
    `UPDATE ticket SET ai_drafts_enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(v, Date.now(), args.ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId: args.ticketId,
    actorType: 'user',
    actorId: args.actorUserId,
    action: 'ticket.ai_drafts_changed',
    payload: { enabled: args.enabled },
  });
  return { ok: true };
}

export async function rejectApproval(
  env: Env,
  workspaceId: string,
  args: { approvalId: string; actorUserId: string; reason?: string },
  refreshCounts: () => Promise<void>,
) {
  await env.DB.prepare(
    `UPDATE approval_request SET status = 'rejected', decided_by_user_id = ?, decided_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(args.actorUserId, Date.now(), args.approvalId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: args.actorUserId,
    action: 'approval.rejected',
    payload: { approvalId: args.approvalId, reason: args.reason },
  });
  await refreshCounts();
}
