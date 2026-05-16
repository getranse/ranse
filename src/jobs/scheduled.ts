import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { runSLASweep } from './sla-sweep';

export async function handleScheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  switch (controller.cron) {
    case '*/5 * * * *':
      ctx.waitUntil(
        runSLASweep(env)
          .then((r) => console.log('sla-sweep', r))
          .catch((e) => console.error('sla-sweep failed', e)),
      );
      break;
    default:
      console.warn('unhandled cron', controller.cron);
  }
}
