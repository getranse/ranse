import type {
  ProcedureSimulationResult,
  ProcedureSimulationStep,
  ProcedureSpec,
  ProcedureStep,
} from '../../types/procedure';
import { normalizeProcedureSpec } from './schema';
import {
  deletePath,
  evaluateCondition,
  getPath,
  renderTemplate,
  renderValue,
  setPath,
} from './template';

export function simulateProcedure(
  input: unknown,
  initialContext: Record<string, unknown> = {},
): ProcedureSimulationResult {
  const spec = normalizeProcedureSpec(input);
  const context = { ...initialContext, procedure_slug: spec.slug };
  const steps: ProcedureSimulationStep[] = [];
  const state = {
    index: 0,
    stopped: false,
    status: 'completed' as ProcedureSimulationResult['status'],
  };

  try {
    visitSteps(spec.steps, spec, context, steps, state);
    return {
      procedure: procedureSummary(spec),
      status: state.status,
      steps,
      context,
    };
  } catch (err) {
    return {
      procedure: procedureSummary(spec),
      status: 'failed',
      steps,
      context,
      error: err instanceof Error ? err.message : 'simulation_failed',
    };
  }
}

function visitSteps(
  procedureSteps: ProcedureStep[],
  spec: ProcedureSpec,
  context: Record<string, unknown>,
  results: ProcedureSimulationStep[],
  state: { index: number; stopped: boolean; status: ProcedureSimulationResult['status'] },
) {
  for (const step of procedureSteps) {
    if (state.stopped) return;
    const stepIndex = state.index++;
    const input = simulatedInput(step, context);

    if (step.type === 'if') {
      const matched = evaluateCondition(step.condition, context);
      results.push({
        step_id: step.id,
        step_index: stepIndex,
        type: step.type,
        status: 'completed',
        input,
        output: { branch: matched ? 'then' : 'else' },
      });
      visitSteps(matched ? step.then : (step.else ?? []), spec, context, results, state);
      continue;
    }

    if (step.type === 'loop') {
      const items = getPath(context, step.each);
      if (!Array.isArray(items)) {
        results.push({
          step_id: step.id,
          step_index: stepIndex,
          type: step.type,
          status: 'failed',
          input,
          output: {},
          error: 'loop_each_not_array',
        });
        state.status = 'failed';
        state.stopped = true;
        return;
      }
      const as = step.as ?? 'item';
      const previous = getPath(context, as);
      const hadPrevious = previous !== undefined;
      const limit = Math.min(items.length, step.max_iterations ?? items.length);
      results.push({
        step_id: step.id,
        step_index: stepIndex,
        type: step.type,
        status: 'completed',
        input,
        output: { iterations: limit },
      });
      for (let i = 0; i < limit; i++) {
        setPath(context, as, items[i]);
        setPath(context, `${as}_index`, i);
        visitSteps(step.steps, spec, context, results, state);
        if (state.stopped) return;
      }
      if (hadPrevious) setPath(context, as, previous);
      else deletePath(context, as);
      deletePath(context, `${as}_index`);
      continue;
    }

    const outcome = simulatePrimitive(step, context);
    results.push({
      step_id: step.id,
      step_index: stepIndex,
      type: step.type,
      status: outcome.status,
      input,
      output: outcome.output,
      error: outcome.error,
    });
    if (outcome.status === 'waiting' || outcome.status === 'failed') {
      state.status = outcome.status;
      state.stopped = true;
    }
  }
}

function simulatedInput(step: ProcedureStep, context: Record<string, unknown>) {
  if (step.type === 'if') return { condition: step.condition };
  if (step.type === 'loop') return { each: step.each, items: getPath(context, step.each) };
  return renderValue(step, context);
}

function simulatePrimitive(step: ProcedureStep, context: Record<string, unknown>) {
  switch (step.type) {
    case 'search': {
      const output = {
        hits: [],
        trace: {
          finalAnswerable: false,
          stopReason: 'simulated',
          plan: {
            originalQuery: renderTemplate(step.query, context),
            scope: step.scope ?? 'all',
            subqueries: [renderTemplate(step.query, context)],
            maxHops: step.max_hops ?? 3,
          },
          hops: [],
        },
      };
      if (step.save_as) setPath(context, step.save_as, output);
      return { status: 'completed' as const, output };
    }
    case 'add_note':
      return {
        status: 'completed' as const,
        output: { preview: renderTemplate(step.body, context).slice(0, 280) },
      };
    case 'ask_customer':
      return { status: 'waiting' as const, output: { waits_for: 'customer_reply' } };
    case 'set_ticket_field':
      setPath(context, `ticket.${step.field}`, renderTemplate(step.value, context));
      return {
        status: 'completed' as const,
        output: { field: step.field, value: getPath(context, `ticket.${step.field}`) },
      };
    case 'escalate_to':
      return {
        status: 'completed' as const,
        output: {
          route_to: renderTemplate(step.route_to, context),
          severity: step.severity ?? 'normal',
        },
      };
    case 'wait_for_event':
      return {
        status: 'waiting' as const,
        output: { waits_for: step.event, timeout_ms: step.timeout_ms ?? null },
      };
    case 'call_action':
      if (step.save_as) {
        setPath(context, step.save_as, {
          simulated: true,
          tool: step.tool,
          args: renderValue(step.args ?? {}, context),
        });
      }
      return {
        status: step.requires_approval === false ? ('completed' as const) : ('waiting' as const),
        output: {
          tool: step.tool,
          args: renderValue(step.args ?? {}, context),
          waits_for: step.requires_approval === false ? undefined : 'approval_decided',
          simulated: true,
        },
      };
    default:
      return { status: 'failed' as const, output: {}, error: 'unsupported_step' };
  }
}

function procedureSummary(spec: ProcedureSpec) {
  return {
    slug: spec.slug,
    name: spec.name,
    version: spec.version,
  };
}
