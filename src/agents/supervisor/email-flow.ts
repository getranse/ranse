import type { Env } from '../../env';
import { buildReplyAddress } from '../../email/reply-security';
import { createApproval } from '../../lib/approvals';
import { audit } from '../../lib/audit';
import { ids } from '../../lib/ids';
import { emitEvent } from '../../notifications/dispatch';
import type { InboundEmailPayload } from '../../types/supervisor';
import { agenticSearchKnowledge } from '../specialists/knowledge';
import { runDraft } from '../specialists/draft';
import { runTriage } from '../specialists/triage';
import type { workspaceConfig } from './settings';

export async function ingestEmail(
  ctx: {
    env: Env;
    workspaceId: string;
    schedule: (delay: number, name: string, payload: unknown) => Promise<void>;
    refreshCounts: () => Promise<void>;
    aiDraftsEnabled: (ticketId: string) => Promise<boolean>;
  },
  payload: InboundEmailPayload,
): Promise<{ ticketId: string; messageId: string }> {
  const now = Date.now();
  let ticketId =
    payload.existingTicketId ?? (await findTicketByReferences(ctx.env, ctx.workspaceId, payload));
  const isNewTicket = !ticketId;
  if (!ticketId) ticketId = await createTicket(ctx.env, ctx.workspaceId, payload, now);

  const messageId = await insertInboundMessage(ctx.env, ctx.workspaceId, ticketId, payload, now);
  await auditInbound(ctx.env, ctx.workspaceId, ticketId, messageId, payload, isNewTicket);
  if (!payload.isAutoReply)
    await emitInboundEvents(ctx.env, ctx.workspaceId, ticketId, messageId, payload, isNewTicket);
  if (!payload.isAutoReply && (await ctx.aiDraftsEnabled(ticketId))) {
    await ctx.schedule(0, 'triageAndDraft', { ticketId, messageId, payload });
  }
  await ctx.refreshCounts();
  return { ticketId, messageId };
}

export async function triageAndDraft(
  ctx: {
    env: Env;
    workspaceId: string;
    refreshCounts: () => Promise<void>;
    workspaceConfig: typeof workspaceConfig;
  },
  args: { ticketId: string; messageId: string; payload: InboundEmailPayload },
) {
  const { ticketId, payload } = args;
  const cfg = await ctx.workspaceConfig(ctx.env, ctx.workspaceId);
  const triage = await runTriage({
    env: ctx.env,
    workspaceId: ctx.workspaceId,
    ticketId,
    subject: payload.subject,
    body: payload.text,
    from: payload.from.address,
    workspaceConfig: cfg,
  });

  await ctx.env.DB.prepare(
    `UPDATE ticket SET category = ?, priority = ?, sentiment = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(triage.category, triage.priority, triage.sentiment, Date.now(), ticketId)
    .run();
  await audit(ctx.env, {
    workspaceId: ctx.workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'triage',
    action: 'ticket.triaged',
    payload: triage as any,
  });

  if (triage.category === 'spam') {
    await ctx.env.DB.prepare(`UPDATE ticket SET status = 'spam' WHERE id = ?`).bind(ticketId).run();
    await ctx.refreshCounts();
    return;
  }

  const retrieval = await agenticSearchKnowledge(
    ctx.env,
    ctx.workspaceId,
    `${payload.subject}\n${payload.text}`,
    {
      workspaceConfig: cfg,
      limit: 5,
      maxHops: 3,
    },
  );
  const draft = await runDraft({
    env: ctx.env,
    workspaceId: ctx.workspaceId,
    ticketId,
    customerMessage: payload.text,
    customerName: payload.from.name,
    knowledge: retrieval.hits,
    workspaceConfig: cfg,
  });
  await createApproval(ctx.env, {
    workspaceId: ctx.workspaceId,
    ticketId,
    kind: 'send_reply',
    proposed: {
      from: await buildReplyAddress({
        supportDomain: payload.mailboxAddress.split('@')[1],
        ticketId,
        mailboxSecret: payload.replySigningSecret,
      }),
      to: payload.from.address,
      subject: draft.subject,
      body_markdown: draft.body_markdown,
      cites_knowledge_ids: draft.cites_knowledge_ids,
      knowledge_hits: retrieval.hits,
      knowledge_trace: retrieval.trace,
      mailboxAddress: payload.mailboxAddress,
      mailboxId: payload.mailboxId,
    },
    riskReasons: riskReasons(draft, triage),
    expiresInMs: 24 * 60 * 60 * 1000,
  });
  await audit(ctx.env, {
    workspaceId: ctx.workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'draft',
    action: 'approval.created',
    payload: {
      confidence: draft.confidence,
      tone: draft.tone,
      riskReasons: riskReasons(draft, triage),
    },
  });
  await ctx.refreshCounts();
}

async function findTicketByReferences(
  env: Env,
  workspaceId: string,
  payload: InboundEmailPayload,
): Promise<string | null> {
  const ids_ = [payload.inReplyTo, ...payload.references].filter(Boolean) as string[];
  if (ids_.length) {
    const row = await env.DB.prepare(
      `SELECT ticket_id FROM message_index WHERE rfc_message_id IN (${ids_.map(() => '?').join(',')}) LIMIT 1`,
    )
      .bind(...ids_)
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

async function createTicket(
  env: Env,
  workspaceId: string,
  payload: InboundEmailPayload,
  now: number,
): Promise<string> {
  const ticketId = ids.ticket();
  await env.DB.prepare(
    `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, priority, requester_email, requester_name, last_message_at, thread_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?, ?)`,
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
    `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, rfc_message_id, in_reply_to, preview, raw_r2_key, has_attachments, sent_at, created_at)
     VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  await env.DB.prepare(`UPDATE ticket SET last_message_at = ?, updated_at = ? WHERE id = ?`)
    .bind(payload.receivedAt, now, ticketId)
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

function riskReasons(
  draft: { confidence: number; needs_human_review_reasons: string[] },
  triage: { sentiment: string; priority: string },
): string[] {
  const reasons: string[] = [];
  if (draft.confidence < 0.7) reasons.push('low_confidence');
  if (draft.needs_human_review_reasons.length) reasons.push(...draft.needs_human_review_reasons);
  if (triage.sentiment === 'hostile') reasons.push('hostile_sentiment');
  if (triage.priority === 'urgent') reasons.push('urgent_priority');
  return reasons;
}
