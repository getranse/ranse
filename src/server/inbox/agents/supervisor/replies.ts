import type { Env } from '../../../env';
import { dispatchOutbound } from '../../channels';
import {
  buildHtmlWithSignature,
  buildMultipartReply,
  buildPlainTextWithSignature,
} from '../../email/html';
import { buildReplyAddress } from '../../email/reply-security';
import { audit } from '../../../actions/audit';
import { buildFeedbackLinks } from '../../../../lib/feedback-links';
import { buildTraceLink } from '../../../actions/decision-trace';
import { ids } from '../../../../lib/ids';
import { rejectVerification } from '../../../platform/insights/honest-resolution';
import { recordLedgerEntry } from '../../../platform/billing/outcomes';
import { r2Keys, putRaw } from '../../../../lib/storage';
import type { SendThreadedReply } from '../../../../types/shared/supervisor';

export function makeSendThreadedReply(
  env: Env,
  workspaceId: string,
  refreshCounts: () => Promise<void>,
): SendThreadedReply {
  return async (args) => {
    const ctx = await loadReplyContext(env, workspaceId, args.ticketId);
    if (!ctx) throw new Error('ticket_not_found');

    const agent = args.actorUserId ? await loadAgent(env, args.actorUserId) : null;
    const messageId = ids.message();

    if (ctx.origin_channel_kind && ctx.origin_channel_kind !== 'email') {
      const text = await persistAndDispatchNonEmail(env, workspaceId, args, ctx, agent, messageId);
      await refreshCounts();
      void text;
      return { messageId };
    }

    const lastInbound = await loadLastInbound(env, workspaceId, args.ticketId);
    const references = await loadReferences(env, workspaceId, args.ticketId);
    const addresses = await buildReplyAddresses(ctx, args.ticketId, agent);
    const subject = (args.subject ?? `Re: ${ctx.ticket_subject}`).replace(/^(re:\s*)+/i, 'Re: ');
    const rfcMessageId = `${messageId}@${addresses.sendingDomain}`;
    const feedbackLinks = await buildFeedbackLinks(env, {
      workspaceId,
      ticketId: args.ticketId,
      messageId,
    });
    // The customer-facing decision trace link is only generated for AI-authored
    // replies — human-authored replies don't have a meaningful trace, and
    // surfacing one would be a privacy hazard (it would expose internal-rep
    // workflow to the customer). The autonomy/procedure path leaves
    // actorUserId null; that's the gate.
    const traceUrl = args.actorUserId
      ? null
      : await buildTraceLink(env, { workspaceId, ticketId: args.ticketId, messageId });
    const body = await buildReplyBodies(args.body, ctx, agent, feedbackLinks, traceUrl);

    const rawMimeText = buildMultipartReply(
      {
        from: addresses.fromHeader,
        to: ctx.requester_email,
        subject,
        messageId: rfcMessageId,
        inReplyTo: lastInbound?.rfc_message_id,
        references,
        replyTo: addresses.replyToAddress,
      },
      body.text,
      body.html,
    );

    const { EmailMessage } = await import('cloudflare:email');
    await env.EMAIL.send(new EmailMessage(addresses.fromAddress, ctx.requester_email, rawMimeText));

    await persistOutboundReply(env, workspaceId, args, {
      messageId,
      rfcMessageId,
      fromAddress: addresses.fromAddress,
      toAddress: ctx.requester_email,
      subject,
      inReplyTo: lastInbound?.rfc_message_id ?? null,
    });
    await refreshCounts();
    return { messageId };
  };
}

async function persistAndDispatchNonEmail(
  env: Env,
  workspaceId: string,
  args: Parameters<SendThreadedReply>[0],
  ctx: NonNullable<Awaited<ReturnType<typeof loadReplyContext>>>,
  agent: Awaited<ReturnType<typeof loadAgent>>,
  messageId: string,
): Promise<void> {
  const subject = args.subject ?? ctx.ticket_subject;
  const fromName = agent?.name ?? ctx.workspace_name ?? 'Support';
  await persistOutboundReply(env, workspaceId, args, {
    messageId,
    rfcMessageId: `${ctx.origin_channel_kind}:${messageId}`,
    fromAddress: `${ctx.origin_channel_kind}:${ctx.mailbox_address}`,
    toAddress: ctx.requester_email,
    subject,
    inReplyTo: null,
  });
  const dispatch = await dispatchOutbound(env, {
    workspaceId,
    ticketId: args.ticketId,
    messageId,
    text: args.body,
    fromName,
  });
  if (dispatch.status === 'failed') {
    throw new Error(`channel_dispatch_failed:${dispatch.channelKind}:${dispatch.error ?? 'unknown'}`);
  }
}

async function loadReplyContext(env: Env, workspaceId: string, ticketId: string) {
  return env.DB.prepare(
    `SELECT t.subject AS ticket_subject, t.requester_email, t.mailbox_id,
            t.origin_channel_kind, t.origin_channel_id,
            m.address AS mailbox_address, m.reply_signing_secret,
            w.name AS workspace_name, w.settings_json AS workspace_settings
       FROM ticket t
       JOIN mailbox m ON m.id = t.mailbox_id
       JOIN workspace w ON w.id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?`,
  )
    .bind(ticketId, workspaceId)
    .first<{
      ticket_subject: string;
      requester_email: string;
      mailbox_id: string;
      origin_channel_kind: string | null;
      origin_channel_id: string | null;
      mailbox_address: string;
      reply_signing_secret: string;
      workspace_name: string;
      workspace_settings: string;
    }>();
}

async function loadAgent(env: Env, userId: string) {
  return env.DB.prepare(`SELECT name, email, signature_markdown, avatar_url FROM user WHERE id = ?`)
    .bind(userId)
    .first<{
      name: string | null;
      email: string;
      signature_markdown: string | null;
      avatar_url: string | null;
    }>();
}

async function loadLastInbound(env: Env, workspaceId: string, ticketId: string) {
  return env.DB.prepare(
    `SELECT rfc_message_id FROM message_index
      WHERE ticket_id = ? AND workspace_id = ? AND direction = 'inbound' AND rfc_message_id IS NOT NULL
      ORDER BY sent_at DESC LIMIT 1`,
  )
    .bind(ticketId, workspaceId)
    .first<{ rfc_message_id: string }>();
}

async function loadReferences(env: Env, workspaceId: string, ticketId: string): Promise<string[]> {
  const refRows = await env.DB.prepare(
    `SELECT rfc_message_id FROM message_index
      WHERE ticket_id = ? AND workspace_id = ? AND rfc_message_id IS NOT NULL
      ORDER BY sent_at ASC`,
  )
    .bind(ticketId, workspaceId)
    .all<{ rfc_message_id: string }>();
  return (refRows.results ?? []).map((r) => r.rfc_message_id);
}

async function buildReplyAddresses(
  ctx: NonNullable<Awaited<ReturnType<typeof loadReplyContext>>>,
  ticketId: string,
  agent: Awaited<ReturnType<typeof loadAgent>>,
) {
  const apexDomain = ctx.mailbox_address.split('@')[1];
  const sendingDomain = `mail.${apexDomain}`;
  const localPart = ctx.mailbox_address.split('@')[0] || 'support';
  const fromAddress = `${localPart}@${sendingDomain}`;
  const replyToAddress = await buildReplyAddress({
    supportDomain: apexDomain,
    ticketId,
    mailboxSecret: ctx.reply_signing_secret,
  });
  const settings = parseWorkspaceSettings(ctx.workspace_settings);
  const fromName = settings.from_name || ctx.workspace_name || 'Support';
  const agentName = agent?.name?.trim();
  const displayName = agentName ? `${agentName} · ${fromName}` : fromName;
  return {
    sendingDomain,
    fromAddress,
    replyToAddress,
    fromHeader: `"${displayName.replace(/"/g, '\\"')}" <${fromAddress}>`,
    fromName,
  };
}

function parseWorkspaceSettings(settingsJson: string): { from_name?: string } {
  try {
    return JSON.parse(settingsJson || '{}');
  } catch {
    return {};
  }
}

async function buildReplyBodies(
  body: string,
  ctx: NonNullable<Awaited<ReturnType<typeof loadReplyContext>>>,
  agent: Awaited<ReturnType<typeof loadAgent>>,
  feedbackLinks: Awaited<ReturnType<typeof buildFeedbackLinks>>,
  traceUrl: string | null = null,
) {
  const settings = parseWorkspaceSettings(ctx.workspace_settings);
  const fromName = settings.from_name || ctx.workspace_name || 'Support';
  const signatureCtx = {
    agentName: agent?.name ?? null,
    agentEmail: agent?.email ?? null,
    agentSignatureMarkdown: agent?.signature_markdown ?? null,
    agentAvatarUrl: agent?.avatar_url ?? null,
    workspaceName: ctx.workspace_name,
    fromName,
  };
  return {
    text: buildPlainTextWithSignature(body, signatureCtx, feedbackLinks, traceUrl),
    html: await buildHtmlWithSignature(body, signatureCtx, feedbackLinks, traceUrl),
  };
}

async function persistOutboundReply(
  env: Env,
  workspaceId: string,
  args: Parameters<SendThreadedReply>[0],
  message: {
    messageId: string;
    rfcMessageId: string;
    fromAddress: string;
    toAddress: string;
    subject: string;
    inReplyTo: string | null;
  },
) {
  const key = r2Keys.textBody(workspaceId, args.ticketId, message.messageId);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO message_index (id, ticket_id, workspace_id, direction, from_address, to_address, subject, rfc_message_id, in_reply_to, preview, body_r2_key, author_user_id, sent_at, created_at)
     VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      message.messageId,
      args.ticketId,
      workspaceId,
      message.fromAddress,
      message.toAddress,
      message.subject,
      message.rfcMessageId,
      message.inReplyTo,
      args.body.slice(0, 280),
      key,
      args.actorUserId,
      now,
      now,
    )
    .run();
  await putRaw(env, key, new TextEncoder().encode(args.body), 'text/plain; charset=utf-8');
  await env.DB.prepare(
    `UPDATE ticket SET status = 'pending', last_message_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(now, now, args.ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId: args.ticketId,
    actorType: args.actorUserId
      ? 'user'
      : ['ai_autonomous', 'procedure'].includes(args.source)
        ? 'agent'
        : 'system',
    actorId:
      args.actorUserId ??
      (args.source === 'ai_autonomous'
        ? 'autonomy'
        : args.source === 'procedure'
          ? 'procedure'
          : undefined),
    action: 'reply.sent',
    payload: {
      messageId: message.messageId,
      source: args.source,
      approvalId: args.approvalId,
      edited: args.edited,
    },
  });
  // Human-authored outbound rejects any pending Honest Resolution verification
  // for this ticket. This is the canonical "human took over" signal Fin papers
  // over by still counting the original AI response as resolved.
  if (args.actorUserId) {
    await rejectVerification(env, workspaceId, args.ticketId, 'human_takeover', {
      replyMessageId: message.messageId,
      actorUserId: args.actorUserId,
    }).catch((err) => console.warn('failed to reject verification on human reply', err));
    await recordLedgerEntry(env, {
      workspaceId,
      ticketId: args.ticketId,
      kind: 'human_takeover_cost',
      metadata: { replyMessageId: message.messageId, actorUserId: args.actorUserId },
    }).catch((err) => console.warn('failed to record human-takeover ledger entry', err));
  }
}
