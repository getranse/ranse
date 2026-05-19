import type { Env } from '../../env';
import { audit } from '../../lib/audit';
import type { ChannelKind } from '../../types/channels';
import type { CascadeStepInput, NotifyCustomerInput } from '../../types/notifications';
import { finalizePlanIfComplete, fireStep, pickNextEligibleStep } from './advancer';
import {
  findPlansDueBefore,
  insertPlan,
  insertStep,
  listPlanSteps,
  recordDeliveryEvent,
  updatePlanStatus,
  updateStepStatus,
} from './store';
import {
  getTemplateBySlug,
  parseTemplateBodies,
  parseTemplateChannels,
  renderTemplate,
} from './templates';

// Public entry point for omnichannel notifications. The cascade is
// materialized into `notification_step` rows up front so the engine is
// stateless — at any time the next step to fire is just "the lowest-
// sequence pending step whose trigger is satisfied". Per-step delivery
// orchestration lives in `advancer.ts`.

export async function notifyCustomer(
  env: Env,
  input: NotifyCustomerInput,
): Promise<{ planId: string; stepCount: number }> {
  const template = input.templateSlug
    ? await getTemplateBySlug(env, input.workspaceId, input.templateSlug)
    : null;
  const cascade = await resolveCascade(env, input, template);
  if (cascade.length === 0) throw new Error('notify_no_cascade_steps');

  const plan = await insertPlan(env, {
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    ticketId: input.ticketId ?? null,
    templateId: template?.id ?? null,
    templateSlug: input.templateSlug ?? null,
    urgency: input.urgency ?? 'normal',
    payload: input.payload ?? {},
    createdByUserId: input.createdByUserId ?? null,
    source: input.source ?? 'api',
  });

  const now = Date.now();
  const bodies = template ? parseTemplateBodies(template) : {};
  let sequence = 0;
  for (const step of cascade) {
    sequence += 1;
    const bodyForKind = bodies[step.channelKind] ?? {};
    const text = step.body?.text ?? bodyForKind.text ?? '';
    const html = step.body?.html ?? bodyForKind.html ?? '';
    const rendered = renderTemplate(text, input.payload ?? {});
    const renderedHtml = html ? renderTemplate(html, input.payload ?? {}) : null;
    await insertStep(env, {
      workspaceId: input.workspaceId,
      planId: plan.id,
      sequence,
      channelKind: step.channelKind,
      channelId: step.channelId ?? null,
      triggerOn: step.triggerOn ?? (sequence === 1 ? 'immediate' : 'previous_no_ack'),
      delayMs: step.delayMs ?? 0,
      scheduledAt: sequence === 1 ? now + (step.delayMs ?? 0) : null,
      bodyText: rendered || null,
      bodyHtml: renderedHtml,
      bodyJson: step.body?.json ? JSON.stringify(step.body.json) : null,
    });
  }

  await updatePlanStatus(env, plan.id, 'active');
  await audit(env, {
    workspaceId: input.workspaceId,
    ticketId: input.ticketId ?? undefined,
    actorType:
      input.source === 'operator' ? 'user' : input.source === 'procedure' ? 'agent' : 'system',
    actorId: input.createdByUserId ?? undefined,
    action: 'notification.plan_created',
    payload: {
      planId: plan.id,
      customerId: input.customerId,
      templateSlug: input.templateSlug ?? null,
      stepCount: sequence,
      urgency: input.urgency ?? 'normal',
    },
  });

  // Best-effort: advance the plan immediately so single-step cascades
  // don't have to wait for the next scheduled tick.
  await advancePlan(env, input.workspaceId, plan.id).catch((err) =>
    console.warn('notification immediate advance failed', err),
  );

  return { planId: plan.id, stepCount: sequence };
}

// Scheduled tick — invoked by `runCascadeSweep`. Picks pending steps that
// are due, attempts delivery, records receipts, and schedules the next
// step's `scheduled_at`.
export async function tickCascadeForWorkspace(env: Env, workspaceId: string): Promise<number> {
  const due = await findPlansDueBefore(env, workspaceId, Date.now());
  let advanced = 0;
  for (const step of due) {
    try {
      const fired = await fireStep(env, step);
      if (fired) advanced += 1;
    } catch (err) {
      await updateStepStatus(env, step.id, 'failed', {
        attemptedAt: Date.now(),
        lastError: err instanceof Error ? err.message : 'cascade_step_failed',
      });
    }
  }
  return advanced;
}

export async function advancePlan(env: Env, workspaceId: string, planId: string): Promise<void> {
  const steps = await listPlanSteps(env, workspaceId, planId);
  if (steps.length === 0) return;
  const next = pickNextEligibleStep(steps, Date.now());
  if (!next) {
    await finalizePlanIfComplete(env, planId, steps);
    return;
  }
  if (!next.scheduled_at) {
    await env.DB.prepare(`UPDATE notification_step SET scheduled_at = ? WHERE id = ?`)
      .bind(Date.now() + next.delay_ms, next.id)
      .run();
  }
  if ((next.scheduled_at ?? Date.now() + next.delay_ms) <= Date.now()) {
    await fireStep(env, next);
  }
}

// Customer reply on any channel → ack the matching open step + finalize.
export async function acknowledgePlansForCustomer(
  env: Env,
  workspaceId: string,
  customerId: string,
  channelKind: ChannelKind,
): Promise<number> {
  const plans = await env.DB.prepare(
    `SELECT id FROM notification_plan
       WHERE workspace_id = ? AND customer_id = ? AND status IN ('pending','active')`,
  )
    .bind(workspaceId, customerId)
    .all<{ id: string }>();
  let acknowledged = 0;
  for (const row of plans.results ?? []) {
    const steps = await listPlanSteps(env, workspaceId, row.id);
    const target = steps.find((s) => s.channel_kind === channelKind && s.status === 'sent');
    if (!target) continue;
    await updateStepStatus(env, target.id, 'read', { acknowledgedAt: Date.now() });
    await updatePlanStatus(env, row.id, 'completed', {
      acknowledgedAt: Date.now(),
      completedAt: Date.now(),
    });
    await recordDeliveryEvent(env, {
      workspaceId,
      stepId: target.id,
      kind: 'replied',
      payload: { customerId, channelKind },
    });
    acknowledged += 1;
  }
  return acknowledged;
}

async function resolveCascade(
  _env: Env,
  input: NotifyCustomerInput,
  template: Awaited<ReturnType<typeof getTemplateBySlug>>,
): Promise<CascadeStepInput[]> {
  if (input.cascade && input.cascade.length > 0) return input.cascade;
  if (template) return parseTemplateChannels(template);
  return [];
}
