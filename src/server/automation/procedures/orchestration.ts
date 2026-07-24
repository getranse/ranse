import { getAgentByName } from 'agents';
import type { ProcedureEventType } from '../../../types/shared/procedures';
import { audit } from '../../actions/audit';
import {
  createProcedureRun,
  listTriggeredProcedures,
  listWaitingProcedureRunsForTicket,
} from '../../actions/procedures';
import type { Env } from '../../env';

export async function startProcedureRunner(env: Env, workspaceId: string, runId: string) {
  const stub = await getAgentByName(env.ProcedureRunnerAgent as never, runId);
  return (stub as any).start({ workspaceId, runId });
}

export async function resumeProcedureRunner(
  env: Env,
  workspaceId: string,
  runId: string,
  event: ProcedureEventType,
  payload?: Record<string, unknown>,
) {
  const stub = await getAgentByName(env.ProcedureRunnerAgent as never, runId);
  return (stub as any).resume({ workspaceId, runId, event, payload });
}

export async function resumeWaitingProcedureRuns(
  env: Env,
  workspaceId: string,
  args: {
    ticketId: string;
    event: ProcedureEventType;
    payload?: Record<string, unknown>;
  },
): Promise<number> {
  const runs = await listWaitingProcedureRunsForTicket(env, workspaceId, args.ticketId);
  await Promise.all(
    runs.map(async (run) => {
      try {
        const stub = await getAgentByName(env.ProcedureRunnerAgent as never, run.id);
        await (stub as any).resume({
          workspaceId,
          runId: run.id,
          event: args.event,
          payload: args.payload,
        });
      } catch (err) {
        await audit(env, {
          workspaceId,
          ticketId: args.ticketId,
          actorType: 'system',
          action: 'procedure.resume_failed',
          payload: {
            runId: run.id,
            event: args.event,
            error: err instanceof Error ? err.message : 'resume_failed',
          },
        });
      }
    }),
  );
  return runs.length;
}

export async function startTriggeredProcedureRuns(
  env: Env,
  workspaceId: string,
  args: {
    ticketId: string;
    trigger: {
      type: 'ticket_created' | 'intent';
      category?: string | null;
      intent?: string | null;
    };
    context?: Record<string, unknown>;
    eventKey: string;
  },
): Promise<number> {
  const procedures = await listTriggeredProcedures(env, workspaceId, args.trigger);
  let started = 0;
  for (const procedure of procedures) {
    try {
      const { run, created } = await createProcedureRun(env, {
        workspaceId,
        ticketId: args.ticketId,
        procedureIdOrSlug: procedure.id,
        context: args.context,
        triggerEventKey: `${args.eventKey}:${procedure.id}`,
      });
      if (!created) continue;
      started += 1;
      await startProcedureRunner(env, workspaceId, run.id);
    } catch (err) {
      await audit(env, {
        workspaceId,
        ticketId: args.ticketId,
        actorType: 'system',
        action: 'procedure.trigger_failed',
        payload: {
          procedureId: procedure.id,
          trigger: args.trigger,
          eventKey: args.eventKey,
          error: err instanceof Error ? err.message : 'trigger_failed',
        },
      });
    }
  }
  return started;
}
