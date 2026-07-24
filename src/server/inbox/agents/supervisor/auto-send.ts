import type { AutoSendCtx } from '../../../../interfaces/agents';
import { audit } from '../../../actions/audit';
import { isTicketRequesterSuppressed } from '../../../actions/suppression';
import { captureResolvedTicketEvalCase } from '../../../automation/evals/capture';
import { enqueueVerification } from '../../../platform/insights/honest-resolution';
import { recordOutcome } from '../../../platform/outcomes';
import type { DraftResult } from '../specialists/draft';
import type { loadMailboxAutonomy, scoreAutonomousDraft } from './autonomy';

export async function tryAutoSend(
  ctx: AutoSendCtx,
  ticketId: string,
  sourceMessageId: string,
  draft: DraftResult,
  subject: string,
  autonomy: Awaited<ReturnType<typeof loadMailboxAutonomy>>,
  score: ReturnType<typeof scoreAutonomousDraft>,
  reason: string,
): Promise<boolean> {
  // Delivery-failure guard: an address on the suppression list gets no AI
  // auto-send — the draft falls back to the human approval queue instead.
  if (await isTicketRequesterSuppressed(ctx.env, ctx.workspaceId, ticketId)) {
    await auditAutoSendFailed(ctx, ticketId, reason, 'recipient_suppressed');
    return false;
  }
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
    // Open the Honest Resolution verification window. The autonomous reply
    // counts as a verified resolution only if no human takes over, no
    // escalation fires, and no negative follow-up arrives within 7 days.
    await enqueueVerification(ctx.env, {
      workspaceId: ctx.workspaceId,
      ticketId,
      aiMessageId: sent.messageId,
      source: 'autonomous',
      payload: { confidence: score.score, policy: autonomy.policy },
    }).catch((err) => console.warn('failed to enqueue verification', err));
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
    await auditAutoSendFailed(
      ctx,
      ticketId,
      reason,
      err instanceof Error ? err.message : 'send_failed',
    );
    return false;
  }
}

async function auditAutoSendFailed(
  ctx: AutoSendCtx,
  ticketId: string,
  reason: string,
  error: string,
) {
  await audit(ctx.env, {
    workspaceId: ctx.workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'autonomy',
    action: 'reply.auto_send_failed',
    payload: { reason, error },
  });
}
