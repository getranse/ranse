import { dispatchOutbound } from '../../channels/egress';
import { getPublicChannel } from '../../channels/lookup';
import type { Env } from '../../env';
import { ids } from '../../lib/ids';
import { putRaw, r2Keys } from '../../lib/storage';
import type { ChannelKind } from '../../../types/channels';
import type {
  NotificationPlan,
  NotificationStep,
  NotificationStepTrigger,
} from '../../../types/notifications';
import { canDeliverTo } from '../preferences';
import { listPlanSteps, recordDeliveryEvent, updatePlanStatus, updateStepStatus } from './store';

// Low-level cascade engine — pick the next eligible step, fire it through
// the adapter, schedule its successor. Split out of `runner.ts` so the
// public entry-point (`notifyCustomer`, `tickCascadeForWorkspace`) stays
// readable and each file owns one concern.

export async function fireStep(env: Env, step: NotificationStep): Promise<boolean> {
  const plan = await env.DB.prepare(`SELECT * FROM notification_plan WHERE id = ?`)
    .bind(step.plan_id)
    .first<NotificationPlan>();
  if (!plan || plan.status === 'cancelled' || plan.status === 'completed') return false;

  const preferenceCheck = await canDeliverTo(env, {
    workspaceId: step.workspace_id,
    customerId: plan.customer_id,
    channelKind: step.channel_kind,
  });
  if (!preferenceCheck.allowed) {
    await updateStepStatus(env, step.id, 'skipped', {
      attemptedAt: Date.now(),
      lastError: `preference_${preferenceCheck.reason ?? 'blocked'}`,
    });
    await recordDeliveryEvent(env, {
      workspaceId: step.workspace_id,
      stepId: step.id,
      kind: 'failed',
      payload: { reason: preferenceCheck.reason },
    });
    await scheduleNextStepAfter(env, step, plan, true);
    return false;
  }

  const channel = step.channel_id
    ? await getPublicChannel(env, step.workspace_id, step.channel_id)
    : await pickDefaultChannelForKind(env, step.workspace_id, step.channel_kind);
  if (!channel) {
    await updateStepStatus(env, step.id, 'failed', {
      attemptedAt: Date.now(),
      lastError: 'no_channel_configured',
    });
    await scheduleNextStepAfter(env, step, plan, true);
    return false;
  }

  // Voice cascade is intentionally a no-op — placing an outbound call is
  // expensive and customers expect explicit opt-in for it. The step is
  // marked skipped so the cascade still advances to the next channel.
  if (step.channel_kind === 'voice') {
    await updateStepStatus(env, step.id, 'skipped', {
      attemptedAt: Date.now(),
      lastError: 'voice_cascade_not_yet_implemented',
    });
    await scheduleNextStepAfter(env, step, plan, true);
    return false;
  }

  const messageId = ids.message();
  const text = step.body_text ?? '';
  if (!text.trim()) {
    await updateStepStatus(env, step.id, 'failed', {
      attemptedAt: Date.now(),
      lastError: 'empty_body',
    });
    await scheduleNextStepAfter(env, step, plan, true);
    return false;
  }

  // Persist a synthetic message_index row so the operator UI sees the
  // outbound in the timeline; the body lives in R2 for parity with normal
  // outbound replies. We only do this when the plan is attached to a
  // ticket — campaign-style notifications can omit the ticket.
  if (plan.ticket_id) {
    const bodyKey = r2Keys.textBody(plan.workspace_id, plan.ticket_id, messageId);
    await putRaw(env, bodyKey, new TextEncoder().encode(text), 'text/plain; charset=utf-8');
    await env.DB.prepare(
      `INSERT INTO message_index (
         id, ticket_id, workspace_id, direction, from_address, to_address, subject,
         rfc_message_id, preview, body_r2_key, sent_at, created_at
       ) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        messageId,
        plan.ticket_id,
        plan.workspace_id,
        channel.mailbox_address ?? '',
        '',
        `Notification: ${plan.template_slug ?? 'ad-hoc'}`,
        `notification:${plan.id}:${step.sequence}`,
        text.slice(0, 280),
        bodyKey,
        Date.now(),
        Date.now(),
      )
      .run();
  }

  const dispatch = await dispatchOutbound(env, {
    workspaceId: step.workspace_id,
    ticketId: plan.ticket_id ?? '',
    messageId,
    text,
    html: step.body_html ?? null,
    overrideChannelKind: step.channel_kind,
    overrideChannelId: channel.id,
  });

  if (dispatch.status === 'delivered') {
    await updateStepStatus(env, step.id, 'sent', {
      attemptedAt: Date.now(),
      externalId: dispatch.externalId,
    });
    await recordDeliveryEvent(env, {
      workspaceId: step.workspace_id,
      stepId: step.id,
      kind: 'sent',
      payload: { externalId: dispatch.externalId, channelKind: dispatch.channelKind },
    });
    return true;
  }
  if (dispatch.status === 'failed') {
    await updateStepStatus(env, step.id, 'failed', {
      attemptedAt: Date.now(),
      lastError: dispatch.error ?? 'dispatch_failed',
    });
    await recordDeliveryEvent(env, {
      workspaceId: step.workspace_id,
      stepId: step.id,
      kind: 'failed',
      payload: { reason: dispatch.error },
    });
    await scheduleNextStepAfter(env, step, plan, true);
    return false;
  }
  await updateStepStatus(env, step.id, 'skipped', { attemptedAt: Date.now() });
  await scheduleNextStepAfter(env, step, plan, true);
  return false;
}

export async function scheduleNextStepAfter(
  env: Env,
  current: NotificationStep,
  plan: NotificationPlan,
  previousFailedOrUnread: boolean,
): Promise<void> {
  const steps = await listPlanSteps(env, current.workspace_id, current.plan_id);
  const next = steps.find((s) => s.sequence === current.sequence + 1);
  if (!next) {
    await finalizePlanIfComplete(env, current.plan_id, steps);
    return;
  }
  if (!stepTriggerSatisfied(next.trigger_on, current, previousFailedOrUnread)) {
    await finalizePlanIfComplete(env, current.plan_id, steps);
    return;
  }
  if (next.scheduled_at) return;
  const baseDelay = urgencyBaseDelayMs(plan.urgency);
  await env.DB.prepare(`UPDATE notification_step SET scheduled_at = ? WHERE id = ?`)
    .bind(Date.now() + Math.max(next.delay_ms, baseDelay), next.id)
    .run();
}

export async function finalizePlanIfComplete(
  env: Env,
  planId: string,
  steps: NotificationStep[],
): Promise<void> {
  const open = steps.some((s) => s.status === 'pending');
  if (open) return;
  const anyAck = steps.some((s) => s.acknowledged_at !== null || s.status === 'read');
  await updatePlanStatus(env, planId, anyAck ? 'completed' : 'failed', {
    completedAt: Date.now(),
  });
}

export function pickNextEligibleStep(
  steps: NotificationStep[],
  now: number,
): NotificationStep | null {
  for (const step of steps) {
    if (step.status !== 'pending') continue;
    if (step.scheduled_at !== null && step.scheduled_at > now) continue;
    return step;
  }
  return null;
}

function stepTriggerSatisfied(
  trigger: NotificationStepTrigger,
  prev: NotificationStep,
  previousFailedOrUnread: boolean,
): boolean {
  switch (trigger) {
    case 'immediate':
      return true;
    case 'time_elapsed':
      return true;
    case 'previous_failed':
      return prev.status === 'failed' || prev.status === 'skipped';
    case 'previous_unread':
      return previousFailedOrUnread || prev.status === 'skipped';
    case 'previous_no_ack':
      return prev.status !== 'read' && prev.acknowledged_at === null;
    default:
      return false;
  }
}

async function pickDefaultChannelForKind(env: Env, workspaceId: string, kind: ChannelKind) {
  return env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.workspace_id = ? AND c.kind = ? AND c.enabled = 1
      ORDER BY c.updated_at DESC LIMIT 1`,
  )
    .bind(workspaceId, kind)
    .first<any>();
}

function urgencyBaseDelayMs(urgency: NotificationPlan['urgency']): number {
  switch (urgency) {
    case 'urgent':
      return 60_000;
    case 'high':
      return 5 * 60_000;
    case 'normal':
      return 30 * 60_000;
    case 'low':
      return 4 * 60 * 60_000;
  }
}
