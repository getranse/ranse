import { Agent, callable } from 'agents';
import type { Env } from '../env';
import type { ProcedureEventType } from '../types/procedure';
import { getProcedureRunDetail } from '../procedures/storage';
import { runProcedure } from '../procedures/runner';

interface ProcedureRunnerState {
  runId: string;
  workspaceId: string;
  lastEventAt: number;
}

const INITIAL_STATE: ProcedureRunnerState = {
  runId: '',
  workspaceId: '',
  lastEventAt: 0,
};

export class ProcedureRunnerAgent extends Agent<Env, ProcedureRunnerState> {
  initialState: ProcedureRunnerState = INITIAL_STATE;

  @callable()
  async start(args: { workspaceId: string; runId: string }) {
    await this.setState({ ...this.state, workspaceId: args.workspaceId, runId: args.runId });
    const run = await runProcedure(this.env, args.workspaceId, args.runId);
    await this.scheduleWaitTimeout(args.workspaceId, args.runId);
    return run;
  }

  @callable()
  async resume(args: {
    workspaceId?: string;
    runId?: string;
    event: ProcedureEventType;
    payload?: Record<string, unknown>;
  }) {
    const workspaceId = args.workspaceId ?? this.state.workspaceId;
    const runId = args.runId ?? this.state.runId ?? this.name;
    if (!workspaceId || !runId) throw new Error('procedure_runner_not_initialized');
    await this.setState({ ...this.state, workspaceId, runId, lastEventAt: Date.now() });
    const run = await runProcedure(this.env, workspaceId, runId, {
      event: { type: args.event, payload: args.payload },
    });
    await this.scheduleWaitTimeout(workspaceId, runId);
    return run;
  }

  async timeout(args: { workspaceId: string; runId: string; stepIndex: number }) {
    const run = await runProcedure(this.env, args.workspaceId, args.runId, {
      event: { type: 'timeout', payload: { stepIndex: args.stepIndex } },
    });
    await this.scheduleWaitTimeout(args.workspaceId, args.runId);
    return run;
  }

  private async scheduleWaitTimeout(workspaceId: string, runId: string) {
    const detail = await getProcedureRunDetail(this.env, workspaceId, runId);
    if (!detail || detail.run.status !== 'waiting') return;
    const context = parseContext(detail.run.context_json);
    const waiting = context.__procedure?.waiting;
    if (!waiting || typeof waiting !== 'object') return;
    const timeoutMs = (waiting as any).timeout_ms;
    const stepIndex = (waiting as any).step_index;
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isFinite(timeoutMs) ||
      typeof stepIndex !== 'number'
    ) {
      return;
    }
    await this.schedule(
      Math.max(1, Math.ceil(timeoutMs / 1000)),
      'timeout',
      { workspaceId, runId, stepIndex },
      { idempotent: true },
    );
  }
}

function parseContext(value: string): { __procedure?: { waiting?: unknown } } {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
