import type { Env } from '../../env';
import { buildReplyAddress } from '../../email/reply-security';
import { captureResolvedTicketEvalCase } from '../../evals/capture';
import { createApproval } from '../../lib/approvals';
import { audit } from '../../lib/audit';
import { recordOutcome } from '../../lib/outcomes';
import { agenticSearchKnowledge, recordKnowledgeUsage } from '../../knowledge';
import type { InboundEmailPayload, SendThreadedReply } from '../../types/supervisor';
import { runDraft, type DraftResult } from '../specialists/draft';
import { runTriage, type TriageResult } from '../specialists/triage';
import { autonomyRollout, decideAutonomy, loadMailboxAutonomy, scoreAutonomousDraft } from './autonomy';
import type { workspaceConfig } from './settings';

export async function triageAndDraft(
  ctx: {
    env: Env;
    workspaceId: string;
    refreshCounts: () => Promise<void>;
    sendThreadedReply: SendThreadedReply;
    workspaceConfig: typeof workspaceConfig;
  },
  args: { ticketId: string; messageId: string; payload: InboundEmailPayload },
) {
  const { ticketId, payload } = args;
  if (await hasExistingResponseForSourceMessage(ctx.env, ctx.workspaceId, ticketId, args.messageId)) {
    await audit(ctx.env, {
      workspaceId: ctx.workspaceId,
      ticketId,
      actorType: 'agent',
      actorId: 'draft',
      action: 'automation.duplicate_skipped',
      payload: { sourceMessageId: args.messageId },
    });
    await ctx.refreshCounts();
    return;
  }

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
  await persistTriage(ctx.env, ctx.workspaceId, ticketId, triage);
  if (triage.category === 'spam') {
    await markSpam(ctx.env, ctx.workspaceId, ticketId);
    await ctx.refreshCounts();
    return;
  }
  await startIntentProcedures(ctx, args, triage);

  const retrieval = await agenticSearchKnowledge(
    ctx.env,
    ctx.workspaceId,
    `${payload.subject}\n${payload.text}`,
    { workspaceConfig: cfg, limit: 5, maxHops: 3 },
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
  const mailboxAutonomy = await loadMailboxAutonomy(ctx.env, ctx.workspaceId, payload.mailboxId);
  const autonomyScore = scoreAutonomousDraft({ draft, triage, retrieval });
  const rollout = autonomyRollout({
    mailboxId: payload.mailboxId,
    ticketId,
    percent: mailboxAutonomy.rolloutPercent,
  });
  const decision = decideAutonomy({
    policy: mailboxAutonomy.policy,
    threshold: mailboxAutonomy.threshold,
    rolloutAllowed: rollout.allowed,
    score: autonomyScore,
  });
  const subject = replySubject(draft.subject, payload.subject);
  const proposed = {
    from: await buildReplyAddress({
      supportDomain: payload.mailboxAddress.split('@')[1],
      ticketId,
      mailboxSecret: payload.replySigningSecret,
    }),
    to: payload.from.address,
    subject,
    body_markdown: draft.body_markdown,
    source_message_id: args.messageId,
    cites_knowledge_ids: draft.cites_knowledge_ids,
    knowledge_hits: retrieval.hits,
    knowledge_trace: retrieval.trace,
    mailboxAddress: payload.mailboxAddress,
    mailboxId: payload.mailboxId,
    autonomy: { ...mailboxAutonomy, rollout, decision, score: autonomyScore },
  };

  if (decision.action === 'auto_send') {
    if (await hasExistingResponseForSourceMessage(ctx.env, ctx.workspaceId, ticketId, args.messageId)) {
      await ctx.refreshCounts();
      return;
    }
    const sent = await tryAutoSend(
      ctx,
      ticketId,
      args.messageId,
      draft,
      subject,
      mailboxAutonomy,
      autonomyScore,
      decision.reason,
    );
    if (sent) {
      await recordKnowledgeUsage(ctx.env, ctx.workspaceId, draft.cites_knowledge_ids).catch((err) =>
        console.warn('failed to record knowledge usage', err),
      );
      await ctx.refreshCounts();
      return;
    }
  }

  const decisionReason = decision.action === 'auto_send' ? 'auto_send_failed' : decision.reason;
  const risks = approvalRiskReasons(draft, triage, autonomyScore.riskReasons, decisionReason);
  await createApproval(ctx.env, {
    workspaceId: ctx.workspaceId,
    ticketId,
    kind: 'send_reply',
    proposed,
    riskReasons: risks,
    expiresInMs: 24 * 60 * 60 * 1000,
  });
  await audit(ctx.env, {
    workspaceId: ctx.workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'draft',
    action: 'approval.created',
    payload: { confidence: draft.confidence, tone: draft.tone, autonomyScore: autonomyScore.score, riskReasons: risks },
  });
  await ctx.refreshCounts();
}

async function startIntentProcedures(
  ctx: {
    env: Env;
    workspaceId: string;
  },
  args: { ticketId: string; messageId: string; payload: InboundEmailPayload },
  triage: TriageResult,
) {
  const { startTriggeredProcedureRuns } = await import('../../procedures/orchestration');
  await startTriggeredProcedureRuns(ctx.env, ctx.workspaceId, {
    ticketId: args.ticketId,
    trigger: { type: 'intent', category: triage.category },
    context: {
      ticket: {
        id: args.ticketId,
        subject: args.payload.subject,
        requester_email: args.payload.from.address,
      },
      inbound: { message_id: args.messageId, body: args.payload.text },
      triage,
    },
    eventKey: `intent:${args.messageId}:${triage.category}`,
  });
}

async function persistTriage(env: Env, workspaceId: string, ticketId: string, triage: TriageResult) {
  await env.DB.prepare(
    `UPDATE ticket SET category = ?, priority = ?, sentiment = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(triage.category, triage.priority, triage.sentiment, Date.now(), ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'triage',
    action: 'ticket.triaged',
    payload: triage as any,
  });
}

async function markSpam(env: Env, workspaceId: string, ticketId: string) {
  await env.DB.prepare(`UPDATE ticket SET status = 'spam' WHERE id = ? AND workspace_id = ?`)
    .bind(ticketId, workspaceId)
    .run();
}

async function tryAutoSend(
  ctx: {
    env: Env;
    workspaceId: string;
    sendThreadedReply: SendThreadedReply;
  },
  ticketId: string,
  sourceMessageId: string,
  draft: DraftResult,
  subject: string,
  autonomy: Awaited<ReturnType<typeof loadMailboxAutonomy>>,
  score: ReturnType<typeof scoreAutonomousDraft>,
  reason: string,
): Promise<boolean> {
  try {
    const sent = await ctx.sendThreadedReply({
      ticketId,
      body: draft.body_markdown,
      subject,
      actorUserId: null,
      source: 'ai_autonomous',
    });
    await recordOutcome(ctx.env, {
      workspaceId: ctx.workspaceId,
      ticketId,
      kind: 'resolved_autonomously',
      source: 'agent',
      confidenceScore: score.score,
      payload: {
        messageId: sent.messageId,
        sourceMessageId,
        policy: autonomy.policy,
        threshold: autonomy.threshold,
        rolloutPercent: autonomy.rolloutPercent,
        reason,
        components: score.components,
        citesKnowledgeIds: draft.cites_knowledge_ids,
      },
    });
    await captureResolvedTicketEvalCase(ctx.env, ctx.workspaceId, ticketId).catch((err) =>
      console.warn('failed to capture autonomous eval case', err),
    );
    await audit(ctx.env, {
      workspaceId: ctx.workspaceId,
      ticketId,
      actorType: 'agent',
      actorId: 'autonomy',
      action: 'reply.auto_sent',
      payload: { messageId: sent.messageId, score: score.score, reason },
    });
    return true;
  } catch (err) {
    await audit(ctx.env, {
      workspaceId: ctx.workspaceId,
      ticketId,
      actorType: 'agent',
      actorId: 'autonomy',
      action: 'reply.auto_send_failed',
      payload: { reason, error: err instanceof Error ? err.message : 'send_failed' },
    });
    return false;
  }
}

export async function hasExistingResponseForSourceMessage(
  env: Env,
  workspaceId: string,
  ticketId: string,
  sourceMessageId: string,
): Promise<boolean> {
  const inbound = await env.DB.prepare(
    `SELECT rfc_message_id FROM message_index
      WHERE id = ? AND ticket_id = ? AND workspace_id = ? AND direction = 'inbound'`,
  )
    .bind(sourceMessageId, ticketId, workspaceId)
    .first<{ rfc_message_id: string | null }>();
  if (inbound?.rfc_message_id) {
    const outbound = await env.DB.prepare(
      `SELECT id FROM message_index
        WHERE ticket_id = ? AND workspace_id = ? AND direction = 'outbound' AND in_reply_to = ?
        LIMIT 1`,
    )
      .bind(ticketId, workspaceId, inbound.rfc_message_id)
      .first<{ id: string }>();
    if (outbound) return true;
  }

  const approval = await env.DB.prepare(
    `SELECT id FROM approval_request
      WHERE ticket_id = ? AND workspace_id = ? AND status = 'pending'
        AND json_extract(proposed_json, '$.source_message_id') = ?
      LIMIT 1`,
  )
    .bind(ticketId, workspaceId, sourceMessageId)
    .first<{ id: string }>();
  return !!approval;
}

function replySubject(draftSubject: string, inboundSubject: string): string {
  const subject = (draftSubject.trim() || inboundSubject || 'Support request')
    .replace(/^(re:\s*)+/i, '')
    .trim();
  return `Re: ${subject || 'Support request'}`;
}

function approvalRiskReasons(
  draft: DraftResult,
  triage: TriageResult,
  autonomyReasons: string[],
  decisionReason: string,
): string[] {
  const reasons: string[] = [...autonomyReasons, decisionReason];
  if (draft.confidence < 0.7) reasons.push('low_confidence');
  if (triage.sentiment === 'hostile') reasons.push('hostile_sentiment');
  if (triage.priority === 'urgent') reasons.push('urgent_priority');
  return Array.from(new Set(reasons.filter((reason) => reason !== 'auto_send_always')));
}
