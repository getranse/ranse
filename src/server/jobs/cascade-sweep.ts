import type { Env } from '../env';
import { tickCascadeForWorkspace } from '../notifications/cascade';

// Per-tick cascade sweep. Iterates workspaces that have active plans and
// advances their pending steps. Kept off the hot path of the SLA sweep so
// either can fail independently.

export async function runCascadeSweep(env: Env): Promise<{ workspaces: number; advanced: number }> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT workspace_id FROM notification_plan
       WHERE status IN ('pending','active')`,
  )
    .bind()
    .all<{ workspace_id: string }>();
  let advanced = 0;
  for (const row of rows.results ?? []) {
    try {
      advanced += await tickCascadeForWorkspace(env, row.workspace_id);
    } catch (err) {
      console.warn('cascade tick failed', row.workspace_id, err);
    }
  }
  return { workspaces: rows.results?.length ?? 0, advanced };
}
