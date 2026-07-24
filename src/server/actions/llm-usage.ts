import type { Env } from '../env';

/**
 * Increment the workspace's daily LLM call counter and enforce its optional
 * budget (settings.llm_daily_call_budget; 0/unset = unlimited). Throws
 * `llm_budget_exceeded` once the counter passes the budget so runaway loops
 * and cost blowouts stop at the dispatcher instead of the invoice.
 *
 * Fails open on storage errors: a broken counter must not take down
 * inference for every workspace.
 */
export async function enforceLlmBudget(env: Env, workspaceId: string): Promise<void> {
  let calls: number;
  let budget: number;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const row = await env.DB.prepare(
      `INSERT INTO llm_usage_daily (workspace_id, day, calls, updated_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (workspace_id, day) DO UPDATE SET calls = calls + 1, updated_at = ?3
       RETURNING calls`,
    )
      .bind(workspaceId, day, Date.now())
      .first<{ calls: number }>();
    const ws = await env.DB.prepare(`SELECT settings_json FROM workspace WHERE id = ?`)
      .bind(workspaceId)
      .first<{ settings_json: string | null }>();
    budget = Number(JSON.parse(ws?.settings_json || '{}')?.llm_daily_call_budget ?? 0);
    calls = row?.calls ?? 0;
  } catch (err) {
    console.warn('llm budget check failed open', err);
    return;
  }
  if (Number.isFinite(budget) && budget > 0 && calls > budget) {
    throw new Error('llm_budget_exceeded');
  }
}

/** Today's call count for a workspace (dashboard/reporting). */
export async function llmCallsToday(env: Env, workspaceId: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `SELECT calls FROM llm_usage_daily WHERE workspace_id = ? AND day = ?`,
  )
    .bind(workspaceId, day)
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}
