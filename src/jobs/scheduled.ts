import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { runAllWorkspaceInsightsMaintenance } from '../insights';
import { runCascadeSweep } from './cascade-sweep';
import { runDispatchRetrySweep } from './dispatch-retry-sweep';
import { runSLASweep } from './sla-sweep';

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  switch (controller.cron) {
    case '*/5 * * * *':
      ctx.waitUntil(
        runSLASweep(env)
          .then((r) => console.log('sla-sweep', r))
          .catch((e) => console.error('sla-sweep failed', e)),
      );
      // Cascade + retry sweeps share the same 5-minute cadence so an
      // operator can reason about all customer-visible delivery state on
      // the same heartbeat.
      ctx.waitUntil(
        runCascadeSweep(env)
          .then((r) => console.log('cascade-sweep', r))
          .catch((e) => console.error('cascade-sweep failed', e)),
      );
      ctx.waitUntil(
        runDispatchRetrySweep(env)
          .then((r) => console.log('dispatch-retry-sweep', r))
          .catch((e) => console.error('dispatch-retry-sweep failed', e)),
      );
      break;
    case '17 3 * * 1':
      ctx.waitUntil(
        runAllWorkspaceInsightsMaintenance(env)
          .then((r) => console.log('insights-maintenance', r))
          .catch((e) => console.error('insights-maintenance failed', e)),
      );
      break;
    default:
      console.warn('unhandled cron', controller.cron);
  }
}
