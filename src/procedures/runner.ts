import type { Env } from '../env';
import { audit } from '../lib/audit';
import { ids } from '../lib/ids';
import { recordOutcome } from '../lib/outcomes';
import { putRaw, r2Keys } from '../lib/storage';
import { searchProcedurePrimitive } from '../knowledge';
import type {
  ProcedureEventType,
  ProcedureRun,
  ProcedureStep,
  ProcedureStepRun,
} from '../types/procedure';
import type { SendThreadedReply } from '../types/supervisor';
import { makeSendThreadedReply } from '../agents/supervisor/replies';
import { workspaceConfig } from '../agents/supervisor/settings';
import { getRunBundle, getStepRunByIndex, recordStepRun, updateRun } from './storage';
import {
  deletePath,
  evaluateCondition,
  getPath,
  renderTemplate,
  renderValue,
  setPath,
} from './template';

export interface ProcedureRunEvent {
  type: ProcedureEventType;
  payload?: Record<string, unknown>;
}

export interface ProcedureRunnerOptions {
  event?: ProcedureRunEvent;
  sendThreadedReply?: SendThreadedReply;
}

type ExecutionState = {
  run: ProcedureRun;
  context: Record<string, unknown>;
  nextIndex: number;
  stopped: boolean;
  event?: ProcedureRunEvent;
  sendThreadedReply: SendThreadedReply;
};

type StepExecutionResult =
  | { status: 'completed'; output?: unknown; currentStep?: number }
  | { status: 'waiting'; output?: unknown; currentStep?: number }
  | { status: 'failed'; error: string; output?: unknown; currentStep?: number };

const LOOP_SNAPSHOT_MAX_BYTES = 64_000;
const TICKET_STATUSES = new Set(['open', 'pending', 'resolved', 'closed', 'spam']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export async function runProcedure(
  env: Env,
  workspaceId: string,
  runId: string,
  options: ProcedureRunnerOptions = {},
): Promise<ProcedureRun> {
  const bundle = await getRunBundle(env, workspaceId, runId);
  if (!bundle) throw new Error('procedure_run_not_found');
  if (['completed', 'cancelled'].includes(bundle.run.status)) return bundle.run;

  const context = parseContext(bundle.run.context_json);
  const state: ExecutionState = {
    run: bundle.run,
    context,
    nextIndex: 0,
    stopped: false,
    event: options.event,
    sendThreadedReply:
      options.sendThreadedReply ?? makeSendThreadedReply(env, workspaceId, async () => undefined),
  };

  await updateRun(env, workspaceId, runId, {
    status: 'running',
    currentStep: bundle.run.current_step,
    context,
    startedAt: Date.now(),
    completedAt: null,
  });

  try {
    await executeSteps(env, workspaceId, bundle.spec.steps, state);
    if (!state.stopped) {
      await updateRun(env, workspaceId, runId, {
        status: 'completed',
        currentStep: state.nextIndex,
        context: state.context,
        completedAt: Date.now(),
      });
      await recordProcedureCompletionOutcome(env, workspaceId, bundle.run);
    }
  } catch (err) {
    await failRun(
      env,
      workspaceId,
      runId,
      state,
      err instanceof Error ? err.message : 'procedure_failed',
    );
  }

  const updated = await getRunBundle(env, workspaceId, runId);
  return updated?.run ?? bundle.run;
}

async function executeSteps(
  env: Env,
  workspaceId: string,
  steps: ProcedureStep[],
  state: ExecutionState,
): Promise<void> {
  for (const step of steps) {
    if (state.stopped) return;
    const stepIndex = state.nextIndex++;
    const existing = await getStepRunByIndex(env, workspaceId, state.run.id, stepIndex);
    const skippedByCursor = stepIndex < state.run.current_step;

    if (step.type === 'if') {
      let branch = existing?.status === 'completed'
        ? asObject(safeJson(existing.output_json)).branch
        : undefined;
      if (branch !== 'then' && branch !== 'else') {
        branch = evaluateCondition(step.condition, state.context) ? 'then' : 'else';
      }
      if (!skippedByCursor && existing?.status !== 'completed') {
        await completeStep(
          env,
          workspaceId,
          state,
          step,
          stepIndex,
          { condition: step.condition },
          {
            branch,
          },
        );
      }
      await executeSteps(env, workspaceId, branch === 'then' ? step.then : (step.else ?? []), state);
      continue;
    }

    if (step.type === 'loop') {
      const priorOutput = existing?.status === 'completed'
        ? asObject(safeJson(existing.output_json))
        : {};
      const rawItems = Array.isArray(priorOutput.items)
        ? priorOutput.items
        : getPath(state.context, step.each);
      if (!Array.isArray(rawItems)) {
        await recordFailedStep(
          env,
          workspaceId,
          state,
          step,
          stepIndex,
          { each: step.each, items: rawItems },
          'loop_each_not_array',
        );
        state.stopped = true;
        return;
      }
      const limit = Math.min(rawItems.length, step.max_iterations ?? rawItems.length);
      const items = rawItems.slice(0, limit);
      const snapshot = snapshotLoopItems(items);
      if (!snapshot.ok) {
        await recordFailedStep(
          env,
          workspaceId,
          state,
          step,
          stepIndex,
          { each: step.each, count: rawItems.length },
          snapshot.error,
        );
        state.stopped = true;
        return;
      }
      if (!skippedByCursor && existing?.status !== 'completed') {
        await completeStep(
          env,
          workspaceId,
          state,
          step,
          stepIndex,
          { each: step.each, items },
          {
            iterations: items.length,
            items,
          },
        );
      }
      const as = step.as ?? 'item';
      const previous = getPath(state.context, as);
      const hadPrevious = previous !== undefined;
      for (let i = 0; i < limit; i++) {
        setPath(state.context, as, items[i]);
        setPath(state.context, `${as}_index`, i);
        await executeSteps(env, workspaceId, step.steps, state);
        if (state.stopped) return;
      }
      if (hadPrevious) setPath(state.context, as, previous);
      else deletePath(state.context, as);
      deletePath(state.context, `${as}_index`);
      continue;
    }

    if (skippedByCursor && existing?.status !== 'waiting') continue;
    const result = await executePrimitive(env, workspaceId, state, step, stepIndex, existing);
    if (result.status === 'completed') {
      await completeStep(
        env,
        workspaceId,
        state,
        step,
        stepIndex,
        renderValue(step, state.context),
        result.output ?? {},
        result.currentStep ?? stepIndex + 1,
      );
      continue;
    }
    if (result.status === 'waiting') {
      await recordWaitingStep(env, workspaceId, state, step, stepIndex, result.output ?? {});
      await updateRun(env, workspaceId, state.run.id, {
        status: 'waiting',
        currentStep: result.currentStep ?? stepIndex,
        context: state.context,
        completedAt: null,
      });
      state.stopped = true;
      return;
    }

    await recordFailedStep(
      env,
      workspaceId,
      state,
      step,
      stepIndex,
      renderValue(step, state.context),
      result.error,
      result.output,
    );
    state.stopped = true;
    return;
  }
}

function snapshotLoopItems(items: unknown[]): { ok: true } | { ok: false; error: string } {
  const json = JSON.stringify(items);
  if (json.length > LOOP_SNAPSHOT_MAX_BYTES) {
    return { ok: false, error: 'loop_snapshot_too_large' };
  }
  return { ok: true };
}

async function executePrimitive(
  env: Env,
  workspaceId: string,
  state: ExecutionState,
  step: Exclude<ProcedureStep, { type: 'if' | 'loop' }>,
  stepIndex: number,
  existing: ProcedureStepRun | null,
): Promise<StepExecutionResult> {
  if (existing?.status === 'completed')
    return { status: 'completed', output: safeJson(existing.output_json) };
  if (existing?.status === 'waiting') {
    return resumeWaitingPrimitive(state, step, stepIndex, existing);
  }

  await recordStepRun(env, {
    workspaceId,
    runId: state.run.id,
    stepId: step.id,
    stepIndex,
    status: 'running',
    input: renderValue(step, state.context),
  });

  switch (step.type) {
    case 'search': {
      const result = await searchProcedurePrimitive(
        env,
        workspaceId,
        {
          query: renderTemplate(step.query, state.context),
          scope: step.scope,
          max_hops: step.max_hops,
          limit: 5,
        },
        await workspaceConfig(env, workspaceId),
      );
      if (step.save_as) setPath(state.context, step.save_as, result);
      return { status: 'completed', output: result };
    }
    case 'add_note': {
      const messageId = await addProcedureNote(
        env,
        workspaceId,
        state.run.ticket_id,
        renderTemplate(step.body, state.context),
      );
      return { status: 'completed', output: { messageId } };
    }
    case 'ask_customer': {
      const sent = await state.sendThreadedReply({
        ticketId: state.run.ticket_id,
        actorUserId: null,
        body: renderTemplate(step.message, state.context),
        subject: step.subject ? renderTemplate(step.subject, state.context) : undefined,
        source: 'procedure',
      });
      setPath(state.context, '__procedure.waiting', {
        step_id: step.id,
        step_index: stepIndex,
        event: 'customer_reply',
        message_id: sent.messageId,
      });
      return {
        status: 'waiting',
        output: { waits_for: 'customer_reply', messageId: sent.messageId },
      };
    }
    case 'set_ticket_field': {
      const value = renderTemplate(step.value, state.context).trim();
      const validationError = validateTicketFieldValue(step.field, value);
      if (validationError) {
        return { status: 'failed', error: validationError, output: { field: step.field, value } };
      }
      await setTicketField(env, workspaceId, state.run.ticket_id, step.field, value);
      setPath(state.context, `ticket.${step.field}`, value);
      return { status: 'completed', output: { field: step.field, value } };
    }
    case 'escalate_to': {
      const routeTo = renderTemplate(step.route_to, state.context).trim();
      await escalateTicket(env, workspaceId, state.run.ticket_id, {
        routeTo,
        severity: step.severity ?? 'normal',
        reason: step.reason ? renderTemplate(step.reason, state.context) : null,
      });
      return {
        status: 'completed',
        output: { route_to: routeTo, severity: step.severity ?? 'normal' },
      };
    }
    case 'wait_for_event':
      setPath(state.context, '__procedure.waiting', {
        step_id: step.id,
        step_index: stepIndex,
        event: step.event,
        timeout_ms: step.timeout_ms ?? null,
      });
      return {
        status: 'waiting',
        output: { waits_for: step.event, timeout_ms: step.timeout_ms ?? null },
      };
    case 'call_action':
      return {
        status: 'failed',
        output: { tool: step.tool, requires_approval: step.requires_approval ?? true },
        error: 'mcp_action_unavailable_until_phase_5',
      };
  }
}

function validateTicketFieldValue(
  field: 'status' | 'priority' | 'category',
  value: string,
): string | null {
  if (field === 'status' && !TICKET_STATUSES.has(value)) return 'invalid_ticket_status';
  if (field === 'priority' && !TICKET_PRIORITIES.has(value)) return 'invalid_ticket_priority';
  if (field === 'category' && (value.length === 0 || value.length > 120)) {
    return 'invalid_ticket_category';
  }
  return null;
}

function resumeWaitingPrimitive(
  state: ExecutionState,
  step: Exclude<ProcedureStep, { type: 'if' | 'loop' }>,
  stepIndex: number,
  existing: ProcedureStepRun,
): StepExecutionResult {
  const waitsFor =
    step.type === 'ask_customer'
      ? 'customer_reply'
      : step.type === 'wait_for_event'
        ? step.event
        : null;
  if (!waitsFor) return { status: 'completed', output: safeJson(existing.output_json) };
  if (state.event?.type === 'timeout') {
    const timeoutStepIndex = Number(state.event.payload?.stepIndex);
    if (Number.isInteger(timeoutStepIndex) && timeoutStepIndex !== stepIndex) {
      return { status: 'waiting', output: safeJson(existing.output_json), currentStep: stepIndex };
    }
    return {
      status: 'failed',
      error: 'procedure_wait_timeout',
      output: { ...asObject(safeJson(existing.output_json)), timed_out: true },
    };
  }
  if (state.event?.type === 'manual_resume') {
    deletePath(state.context, '__procedure.waiting');
    setPath(state.context, '__procedure.last_event', {
      type: state.event.type,
      payload: state.event.payload ?? {},
    });
    return {
      status: 'completed',
      output: {
        ...asObject(safeJson(existing.output_json)),
        resumed_by: state.event.type,
        event: state.event.payload ?? {},
      },
    };
  }
  if (state.event?.type !== waitsFor) {
    return { status: 'waiting', output: safeJson(existing.output_json), currentStep: stepIndex };
  }
  deletePath(state.context, '__procedure.waiting');
  setPath(state.context, '__procedure.last_event', {
    type: state.event.type,
    payload: state.event.payload ?? {},
  });
  return {
    status: 'completed',
    output: {
      ...asObject(safeJson(existing.output_json)),
      resumed_by: state.event.type,
      event: state.event.payload ?? {},
    },
  };
}

async function completeStep(
  env: Env,
  workspaceId: string,
  state: ExecutionState,
  step: ProcedureStep,
  stepIndex: number,
  input: unknown,
  output: unknown,
  nextStep = stepIndex + 1,
) {
  await recordStepRun(env, {
    workspaceId,
    runId: state.run.id,
    stepId: step.id,
    stepIndex,
    status: 'completed',
    input,
    output,
  });
  state.run.current_step = Math.max(state.run.current_step, nextStep);
  await updateRun(env, workspaceId, state.run.id, {
    status: 'running',
    currentStep: state.run.current_step,
    context: state.context,
    completedAt: null,
  });
}

async function recordWaitingStep(
  env: Env,
  workspaceId: string,
  state: ExecutionState,
  step: ProcedureStep,
  stepIndex: number,
  output: unknown,
) {
  await recordStepRun(env, {
    workspaceId,
    runId: state.run.id,
    stepId: step.id,
    stepIndex,
    status: 'waiting',
    input: renderValue(step, state.context),
    output,
  });
}

async function recordFailedStep(
  env: Env,
  workspaceId: string,
  state: ExecutionState,
  step: ProcedureStep,
  stepIndex: number,
  input: unknown,
  error: string,
  output: unknown = {},
) {
  await recordStepRun(env, {
    workspaceId,
    runId: state.run.id,
    stepId: step.id,
    stepIndex,
    status: 'failed',
    input,
    output,
    error,
  });
  await failRun(env, workspaceId, state.run.id, state, error, stepIndex);
}

async function failRun(
  env: Env,
  workspaceId: string,
  runId: string,
  state: ExecutionState,
  error: string,
  currentStep = state.run.current_step,
) {
  await updateRun(env, workspaceId, runId, {
    status: 'failed',
    currentStep,
    context: state.context,
    error,
    completedAt: Date.now(),
  });
}

async function addProcedureNote(
  env: Env,
  workspaceId: string,
  ticketId: string,
  body: string,
): Promise<string> {
  const messageId = ids.message();
  const now = Date.now();
  const key = r2Keys.textBody(workspaceId, ticketId, messageId);
  await env.DB.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, preview, body_r2_key, sent_at, created_at
     ) VALUES (?, ?, ?, 'note', ?, ?, ?, ?)`,
  )
    .bind(messageId, ticketId, workspaceId, body.slice(0, 280), key, now, now)
    .run();
  await putRaw(env, key, new TextEncoder().encode(body), 'text/plain; charset=utf-8');
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'procedure',
    action: 'procedure.note_added',
    payload: { messageId },
  });
  return messageId;
}

async function setTicketField(
  env: Env,
  workspaceId: string,
  ticketId: string,
  field: 'status' | 'priority' | 'category',
  value: string,
) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE ticket SET ${field} = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(value, now, ticketId, workspaceId)
    .run();
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'procedure',
    action: `procedure.ticket_${field}_set`,
    payload: { value },
  });
}

async function escalateTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
  args: { routeTo: string; severity: 'low' | 'normal' | 'high' | 'urgent'; reason: string | null },
) {
  await env.DB.prepare(
    `UPDATE ticket SET priority = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(args.severity, Date.now(), ticketId, workspaceId)
    .run();
  await recordOutcome(env, {
    workspaceId,
    ticketId,
    kind: 'escalated',
    source: 'agent',
    payload: { routeTo: args.routeTo, severity: args.severity, reason: args.reason },
  });
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'procedure',
    action: 'procedure.escalated',
    payload: args,
  });
}

async function recordProcedureCompletionOutcome(env: Env, workspaceId: string, run: ProcedureRun) {
  const ticket = await env.DB.prepare(`SELECT status FROM ticket WHERE id = ? AND workspace_id = ?`)
    .bind(run.ticket_id, workspaceId)
    .first<{ status: string }>();
  if (!ticket || !['resolved', 'closed'].includes(ticket.status)) return;
  await recordOutcome(env, {
    workspaceId,
    ticketId: run.ticket_id,
    kind: 'resolved_via_procedure',
    source: 'agent',
    payload: { runId: run.id, procedureId: run.procedure_id, versionId: run.version_id },
  });
}

function parseContext(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
