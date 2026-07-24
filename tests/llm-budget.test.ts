import { describe, expect, it } from 'vitest';
import { enforceLlmBudget, llmCallsToday } from '../src/server/actions/llm-usage';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup(budget?: number) {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  db.exec(`CREATE TABLE llm_usage_daily (
    workspace_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, day))`);
  if (budget !== undefined) {
    db.prepare(`UPDATE workspace SET settings_json = ? WHERE id = 'ws_a'`).run(
      JSON.stringify({ llm_daily_call_budget: budget }),
    );
  }
  return { db, env };
}

describe('per-workspace LLM budget', () => {
  it('counts calls and stays open when no budget is configured', async () => {
    const { env } = setup();
    await enforceLlmBudget(env, 'ws_a');
    await enforceLlmBudget(env, 'ws_a');
    expect(await llmCallsToday(env, 'ws_a')).toBe(2);
  });

  it('throws llm_budget_exceeded once the daily budget is passed', async () => {
    const { env } = setup(2);
    await enforceLlmBudget(env, 'ws_a');
    await enforceLlmBudget(env, 'ws_a');
    await expect(enforceLlmBudget(env, 'ws_a')).rejects.toThrow('llm_budget_exceeded');
    // The over-budget attempt is still counted so operators see the pressure.
    expect(await llmCallsToday(env, 'ws_a')).toBe(3);
  });

  it('fails open when the counter table is missing', async () => {
    const { db, env } = setup(1);
    db.exec(`DROP TABLE llm_usage_daily`);
    await expect(enforceLlmBudget(env, 'ws_a')).resolves.toBeUndefined();
  });
});
