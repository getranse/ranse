import type { Env } from '../env';
import { sweepDueVerifications } from '../insights/honest-resolution';

// Periodic sweep that promotes pending verified_resolution rows to verified
// once their 7-day window closes with no rejection signal. The sweep is
// workspace-agnostic — verified_resolution rows already carry workspace_id
// and we never run more than 2000 per tick (safe even on the busiest tenant).

export async function runHonestResolutionSweep(env: Env) {
  return sweepDueVerifications(env, { limit: 1000 });
}
