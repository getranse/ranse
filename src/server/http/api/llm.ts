import { getAgentByName } from 'agents';
import type { Hono } from 'hono';
import { z } from 'zod';
import { ACTION_KEYS } from '../../../types/llm';
import { OWNER_OR_ADMIN, type Ctx, requireWorkspaceRole } from './context';

// LLM model config + BYOK provider keys, under /api/llm.
export function registerLlmRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/llm', async (c) => {
    const s = c.get('session');
    const rows = await c.env.DB.prepare(
      `SELECT action_key, model_name, fallback_model, temperature
         FROM workspace_llm_config
        WHERE workspace_id = ?`,
    )
      .bind(s.workspaceId)
      .all();
    return c.json({ config: rows.results ?? [] });
  });

  apiApp.post('/llm', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        action_key: z.enum(ACTION_KEYS),
        model_name: z.string().min(1),
        fallback_model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
      })
      .parse(await c.req.json());
    await c.env.DB.prepare(
      `INSERT INTO workspace_llm_config (workspace_id, action_key, model_name, fallback_model, reasoning_effort, temperature, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, action_key) DO UPDATE SET
         model_name=excluded.model_name,
         fallback_model=excluded.fallback_model,
         reasoning_effort=excluded.reasoning_effort,
         temperature=excluded.temperature,
         updated_at=excluded.updated_at`,
    )
      .bind(
        s.workspaceId,
        body.action_key,
        body.model_name,
        body.fallback_model ?? null,
        body.reasoning_effort ?? null,
        body.temperature ?? null,
        Date.now(),
      )
      .run();
    return c.json({ ok: true });
  });

  apiApp.get('/llm/providers', async (c) => {
    const s = c.get('session');
    const stub = await getAgentByName(c.env.UserSecretsStore as never, s.workspaceId);
    return c.json({ providers: await (stub as any).listProviders() });
  });

  apiApp.post('/llm/providers', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({ provider: z.string(), api_key: z.string().min(1) })
      .parse(await c.req.json());
    const stub = await getAgentByName(c.env.UserSecretsStore as never, s.workspaceId);
    await (stub as any).setKey({ provider: body.provider, apiKey: body.api_key });
    return c.json({ ok: true });
  });

  apiApp.delete('/llm/providers/:provider', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const stub = await getAgentByName(c.env.UserSecretsStore as never, s.workspaceId);
    await (stub as any).deleteKey(c.req.param('provider'));
    return c.json({ ok: true });
  });
}
