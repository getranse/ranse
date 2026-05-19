import type { Env } from '../../env';
import { ids } from '../../lib/ids';
import type {
  NotificationDeliveryEvent,
  NotificationDeliveryEventKind,
  NotificationPlan,
  NotificationStep,
  NotificationStepStatus,
  NotificationStepTrigger,
} from '../../types/notifications';

// Pure DB ops for the notification cascade tables. Orchestration logic
// lives in `runner.ts`; this module is the single write path.

export async function getPlan(
  env: Env,
  workspaceId: string,
  planId: string,
): Promise<NotificationPlan | null> {
  return env.DB.prepare(`SELECT * FROM notification_plan WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, planId)
    .first<NotificationPlan>();
}

export async function listPlanSteps(
  env: Env,
  workspaceId: string,
  planId: string,
): Promise<NotificationStep[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM notification_step WHERE workspace_id = ? AND plan_id = ?
       ORDER BY sequence ASC`,
  )
    .bind(workspaceId, planId)
    .all<NotificationStep>();
  return rows.results ?? [];
}

export async function findPlansDueBefore(
  env: Env,
  workspaceId: string,
  before: number,
  limit = 50,
): Promise<NotificationStep[]> {
  const rows = await env.DB.prepare(
    `SELECT s.* FROM notification_step s
       JOIN notification_plan p ON p.id = s.plan_id
      WHERE s.workspace_id = ? AND s.status = 'pending'
        AND p.status IN ('pending','active')
        AND (s.scheduled_at IS NULL OR s.scheduled_at <= ?)
      ORDER BY s.scheduled_at ASC NULLS FIRST
      LIMIT ?`,
  )
    .bind(workspaceId, before, limit)
    .all<NotificationStep>();
  return rows.results ?? [];
}

export interface InsertPlanInput {
  workspaceId: string;
  customerId: string;
  ticketId: string | null;
  templateId: string | null;
  templateSlug: string | null;
  urgency: NotificationPlan['urgency'];
  payload: Record<string, unknown>;
  createdByUserId: string | null;
  source: NotificationPlan['source'];
}

export async function insertPlan(env: Env, input: InsertPlanInput): Promise<NotificationPlan> {
  const id = ids.notificationPlan();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO notification_plan (
       id, workspace_id, customer_id, ticket_id, template_id, template_slug,
       urgency, status, payload_json, created_by_user_id, source,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.customerId,
      input.ticketId,
      input.templateId,
      input.templateSlug,
      input.urgency,
      JSON.stringify(input.payload ?? {}),
      input.createdByUserId,
      input.source,
      now,
      now,
    )
    .run();
  const plan = await getPlan(env, input.workspaceId, id);
  if (!plan) throw new Error('notification_plan_insert_failed');
  return plan;
}

export interface InsertStepInput {
  workspaceId: string;
  planId: string;
  sequence: number;
  channelKind: string;
  channelId: string | null;
  triggerOn: NotificationStepTrigger;
  delayMs: number;
  scheduledAt: number | null;
  bodyText: string | null;
  bodyHtml: string | null;
  bodyJson: string | null;
}

export async function insertStep(env: Env, input: InsertStepInput): Promise<NotificationStep> {
  const id = ids.notificationStep();
  await env.DB.prepare(
    `INSERT INTO notification_step (
       id, workspace_id, plan_id, sequence, channel_kind, channel_id,
       trigger_on, delay_ms, status, scheduled_at, body_text, body_html, body_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.planId,
      input.sequence,
      input.channelKind,
      input.channelId,
      input.triggerOn,
      input.delayMs,
      input.scheduledAt,
      input.bodyText,
      input.bodyHtml,
      input.bodyJson,
    )
    .run();
  const step = await env.DB.prepare(`SELECT * FROM notification_step WHERE id = ?`)
    .bind(id)
    .first<NotificationStep>();
  if (!step) throw new Error('notification_step_insert_failed');
  return step;
}

export async function updateStepStatus(
  env: Env,
  stepId: string,
  status: NotificationStepStatus,
  patch: {
    externalId?: string | null;
    lastError?: string | null;
    deliveredAt?: number | null;
    attemptedAt?: number | null;
    readAt?: number | null;
    acknowledgedAt?: number | null;
  } = {},
): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_step
        SET status = ?,
            external_id = COALESCE(?, external_id),
            last_error = COALESCE(?, last_error),
            attempted_at = COALESCE(?, attempted_at),
            delivered_at = COALESCE(?, delivered_at),
            read_at = COALESCE(?, read_at),
            acknowledged_at = COALESCE(?, acknowledged_at)
      WHERE id = ?`,
  )
    .bind(
      status,
      patch.externalId ?? null,
      patch.lastError ?? null,
      patch.attemptedAt ?? null,
      patch.deliveredAt ?? null,
      patch.readAt ?? null,
      patch.acknowledgedAt ?? null,
      stepId,
    )
    .run();
}

export async function updatePlanStatus(
  env: Env,
  planId: string,
  status: NotificationPlan['status'],
  patch: {
    acknowledgedAt?: number | null;
    completedAt?: number | null;
    cancelledReason?: string | null;
  } = {},
): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_plan
        SET status = ?,
            acknowledged_at = COALESCE(?, acknowledged_at),
            completed_at = COALESCE(?, completed_at),
            cancelled_reason = COALESCE(?, cancelled_reason),
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      status,
      patch.acknowledgedAt ?? null,
      patch.completedAt ?? null,
      patch.cancelledReason ?? null,
      Date.now(),
      planId,
    )
    .run();
}

export async function recordDeliveryEvent(
  env: Env,
  args: {
    workspaceId: string;
    stepId: string;
    kind: NotificationDeliveryEventKind;
    payload?: Record<string, unknown>;
  },
): Promise<NotificationDeliveryEvent> {
  const id = ids.notificationDelivery();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO notification_delivery_event (
       id, workspace_id, step_id, kind, occurred_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, args.workspaceId, args.stepId, args.kind, now, JSON.stringify(args.payload ?? {}))
    .run();
  return {
    id,
    workspace_id: args.workspaceId,
    step_id: args.stepId,
    kind: args.kind,
    occurred_at: now,
    payload_json: JSON.stringify(args.payload ?? {}),
  };
}
