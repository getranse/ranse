import type { ModelConfig } from '../../../../interfaces/llm';
import type { ActionKey, AgentConfig } from '../../../../types/shared/llm';
import type { Env } from '../../../env';

export async function workspaceConfig(
  env: Env,
  workspaceId: string,
): Promise<Partial<AgentConfig> | undefined> {
  if (!workspaceId) return undefined;
  const rows = await env.DB.prepare(
    `SELECT action_key, model_name, fallback_model, reasoning_effort, temperature
       FROM workspace_llm_config WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .all<{
      action_key: string;
      model_name: string;
      fallback_model: string | null;
      reasoning_effort: string | null;
      temperature: number | null;
    }>();
  const out: Partial<AgentConfig> = {};
  for (const r of rows.results ?? []) {
    out[r.action_key as ActionKey] = {
      model: r.model_name,
      fallbackModel: r.fallback_model ?? undefined,
      reasoningEffort: (r.reasoning_effort as ModelConfig['reasoningEffort']) ?? undefined,
      temperature: r.temperature ?? undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}
