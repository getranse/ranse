import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { runAllWorkspaceInsightsMaintenance } from '../insights';
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
