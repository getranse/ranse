import type { Env } from '../../env';
import { audit } from '../../lib/audit';
import { ids } from '../../lib/ids';
import { recordOutcome } from '../../outcomes';
import { emitEvent } from '../../notifications/dispatch';
import type { InboundEmailPayload } from '../../../types/supervisor';

export async function ingestEmail(
  ctx: {
    env: Env;
    workspaceId: string;
    schedule: (delay: number, name: string, payload: unknown) => Promise<void>;
    refreshCounts: () => Promise<void>;
    aiDraftsEnabled: (ticketId: string) => Promise<boolean>;
  },
  payload: InboundEmailPayload,
): Promise<{ ticketId: string; messageId: string; isNewTicket: boolean }> {
  const now = Date.now();
  const matchedTicketId =
    payload.existingTicketId ?? (await findTicketByReferences(ctx.env, ctx.workspaceId, payload));
  const existingTicket = matchedTicketId
    ? await loadTicketStatus(ctx.env, ctx.workspaceId, matchedTicketId)
    : null;
  const isNewTicket = !existingTicket;
  const ticketId =
    existingTicket && matchedTicketId
      ? matchedTicketId
      : await createTicket(ctx.env, ctx.workspaceId, payload, now);

  const messageId = await insertInboundMessage(ctx.env, ctx.workspaceId, ticketId, payload, now);
  await auditInbound(ctx.env, ctx.workspaceId, ticketId, messageId, payload, isNewTicket);
  if (!isNewTicket && existingTicket && !payload.isAutoReply) {
    await recordCustomerFollowUp(
      ctx.env,
      ctx.workspaceId,
      ticketId,
      messageId,
      existingTicket.status,
    );
  }
  if (!payload.isAutoReply)
    await emitInboundEvents(ctx.env, ctx.workspaceId, ticketId, messageId, payload, isNewTicket);
  if (!payload.isAutoReply && (await ctx.aiDraftsEnabled(ticketId))) {
    await ctx.schedule(0, 'triageAndDraft', { ticketId, messageId, payload });
  }
  await ctx.refreshCounts();
  return { ticketId, messageId, isNewTicket };
}

async function findTicketByReferences(
  env: Env,
  workspaceId: string,
  payload: InboundEmailPayload,
): Promise<string | null> {
  const ids_ = [payload.inReplyTo, ...payload.references].filter(Boolean) as string[];
  if (ids_.length) {
    const row = await env.DB.prepare(
      `SELECT mi.ticket_id FROM message_index mi
        JOIN ticket t ON t.id = mi.ticket_id
       WHERE mi.workspace_id = ? AND t.workspace_id = ?
         AND mi.rfc_message_id IN (${ids_.map(() => '?').join(',')})
       LIMIT 1`,
    )
      .bind(workspaceId, workspaceId, ...ids_)
      .first<{ ticket_id: string }>();
    if (row) return row.ticket_id;
  }
  const since = Date.now() - 72 * 3600 * 1000;
  const row = await env.DB.prepare(
    `SELECT id FROM ticket
      WHERE workspace_id = ? AND requester_email = ? AND status IN ('open','pending') AND last_message_at > ?
      ORDER BY last_message_at DESC LIMIT 1`,
  )
    .bind(workspaceId, payload.from.address.toLowerCase(), since)
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function loadTicketStatus(env: Env, workspaceId: string, ticketId: string) {
  return env.DB.prepare(`SELECT status FROM ticket WHERE id = ? AND workspace_id = ?`)
    .bind(ticketId, workspaceId)
    .first<{ status: string }>();
}

async function createTicket(
  env: Env,
  workspaceId: string,
  payload: InboundEmailPayload,
  now: number,
): Promise<string> {
  const ticketId = ids.ticket();
  await env.DB.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, requester_email,
       requester_name, last_message_at, thread_token, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ticketId,
      workspaceId,
      payload.mailboxId,
      payload.subject,
      payload.from.address.toLowerCase(),
      payload.from.name ?? null,
      payload.receivedAt,
      ids.ticket().slice(4),
      now,
      now,
    )
    .run();
  return ticketId;
}

async function insertInboundMessage(
  env: Env,
  workspaceId: string,
  ticketId: string,
  payload: InboundEmailPayload,
  now: number,
): Promise<string> {
  const messageId = ids.message();
  await env.DB.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, from_address, to_address, subject,
       rfc_message_id, in_reply_to, preview, raw_r2_key, has_attachments, sent_at, created_at
     ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      messageId,
      ticketId,
      workspaceId,
      payload.from.address,
      payload.to[0] ?? payload.mailboxAddress,
      payload.subject,
      payload.messageId,
      payload.inReplyTo ?? null,
      payload.text.slice(0, 280),
      payload.rawKey,
      payload.attachmentCount > 0 ? 1 : 0,
      payload.receivedAt,
      now,
    )
    .run();
  await env.DB.prepare(
    `UPDATE ticket SET last_message_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(payload.receivedAt, now, ticketId, workspaceId)
    .run();
  return messageId;
}

async function auditInbound(
  env: Env,
  workspaceId: string,
  ticketId: string,
  messageId: string,
  payload: InboundEmailPayload,
  isNewTicket: boolean,
) {
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'system',
    action: isNewTicket ? 'ticket.created' : 'ticket.message_received',
    payload: {
      messageId,
      from: payload.from.address,
      subject: payload.subject,
      isAutoReply: payload.isAutoReply,
    },
  });
}

async function recordCustomerFollowUp(
  env: Env,
  workspaceId: string,
  ticketId: string,
  messageId: string,
  previousStatus: string,
) {
  if (!['pending', 'resolved', 'closed'].includes(previousStatus)) return;
  await env.DB.prepare(
    `UPDATE ticket SET status = 'open', updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(Date.now(), ticketId, workspaceId)
    .run();
  await recordOutcome(env, {
    workspaceId,
    ticketId,
    kind: 'customer_followed_up',
    source: 'system',
    payload: { messageId, previousStatus },
  });
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'system',
    action: 'customer.followed_up',
    payload: { messageId, previousStatus },
  });
}

async function emitInboundEvents(
  env: Env,
  workspaceId: string,
  ticketId: string,
  messageId: string,
  payload: InboundEmailPayload,
  isNewTicket: boolean,
) {
  const preview = payload.text.slice(0, 280);
  if (isNewTicket) {
    await emitEvent(env, workspaceId, 'ticket.created', {
      ticketId,
      subject: payload.subject,
      requesterEmail: payload.from.address,
      requesterName: payload.from.name ?? null,
      preview,
      mailboxAddress: payload.mailboxAddress,
      receivedAt: payload.receivedAt,
    });
  }
  await emitEvent(env, workspaceId, 'message.inbound', {
    ticketId,
    messageId,
    subject: payload.subject,
    fromAddress: payload.from.address,
    fromName: payload.from.name ?? null,
    preview,
    isReplyToExisting: !isNewTicket,
    receivedAt: payload.receivedAt,
  });
}
