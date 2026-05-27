import { retryPendingDispatch } from '../channels/egress';
import type { Env } from '../env';

// Periodic outbound dispatch retry. Looks for `channel_outbound_dispatch`
// rows whose `next_attempt_at <= now` and re-fires the adapter. Failures
// pick the next backoff slot; once `max_attempts` is reached the row
// settles into status='failed' and shows up in the operator dispatch panel
// for manual intervention.

const MAX_DISPATCHES_PER_TICK = 100;

export async function runDispatchRetrySweep(
  env: Env,
): Promise<{ retried: number; delivered: number; failed: number }> {
  const due = await env.DB.prepare(
    `SELECT id FROM channel_outbound_dispatch
       WHERE status = 'pending'
         AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC
       LIMIT ?`,
  )
    .bind(Date.now(), MAX_DISPATCHES_PER_TICK)
    .all<{ id: string }>();
  let delivered = 0;
  let failed = 0;
  let retried = 0;
  for (const row of due.results ?? []) {
    try {
      const outcome = await retryPendingDispatch(env, row.id);
      retried += 1;
      if (outcome === 'delivered') delivered += 1;
      else if (outcome === 'failed') failed += 1;
    } catch (err) {
      console.warn('dispatch retry failed', row.id, err);
    }
  }
  return { retried, delivered, failed };
}
