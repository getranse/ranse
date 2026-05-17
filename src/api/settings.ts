import { getAgentByName } from 'agents';
import type { Hono } from 'hono';
import { z } from 'zod';
import { r2Keys, putRaw } from '../lib/storage';
import { ACTION_KEYS } from '../types/llm';
import { OWNER_OR_ADMIN, type Ctx, getSupervisor, requireWorkspaceRole } from './context';
import { readUploadedImage } from './files';

export function registerSettingsRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/settings/workspace', async (c) => {
    const s = c.get('session');
    const stub = await getSupervisor(c.env, s.workspaceId);
    return c.json(await (stub as any).getWorkspaceSettings());
  });

  apiApp.post('/settings/workspace', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        ai_drafts_enabled: z.boolean().optional(),
        from_name: z.string().max(100).optional(),
        logo_url: z.union([z.string().url().max(500), z.literal('')]).optional(),
      })
      .parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setWorkspaceSettings({ actorUserId: s.userId, ...body });
    return c.json({ ok: true });
  });

  apiApp.post('/uploads/workspace-logo', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const result = await readUploadedImage(c, 2 * 1024 * 1024);
    if (result instanceof Response) return result;
    const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${result.ext}`;
    const key = r2Keys.workspaceAsset(s.workspaceId, 'logo', filename);
    await putRaw(c.env, key, result.bytes, result.contentType);
    const url = `${new URL(c.req.url).origin}/${key}`;
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setWorkspaceSettings({ actorUserId: s.userId, logo_url: url });
    return c.json({ ok: true, url });
  });

  apiApp.post('/uploads/avatar', async (c) => {
    const s = c.get('session');
    const result = await readUploadedImage(c, 1 * 1024 * 1024);
    if (result instanceof Response) return result;
    const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${result.ext}`;
    const key = r2Keys.userAsset(s.workspaceId, s.userId, 'avatar', filename);
    await putRaw(c.env, key, result.bytes, result.contentType);
    const url = `${new URL(c.req.url).origin}/${key}`;
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setAgentProfile({ userId: s.userId, avatar_url: url });
    return c.json({ ok: true, url });
  });

  apiApp.get('/me/profile', async (c) => {
    const s = c.get('session');
    const stub = await getSupervisor(c.env, s.workspaceId);
    return c.json((await (stub as any).getAgentProfile({ userId: s.userId })) ?? {});
  });

  apiApp.post('/me/profile', async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        name: z.string().max(100).optional(),
        signature_markdown: z.string().max(5000).optional(),
        avatar_url: z.union([z.string().url().max(500), z.literal('')]).optional(),
      })
      .parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setAgentProfile({ userId: s.userId, ...body });
    return c.json({ ok: true });
  });

  apiApp.get('/settings/llm', async (c) => {
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

  apiApp.post('/settings/llm', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
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

  apiApp.get('/settings/providers', async (c) => {
    const s = c.get('session');
    const stub = await getAgentByName(c.env.UserSecretsStore as never, s.workspaceId);
    return c.json({ providers: await (stub as any).listProviders() });
  });

  apiApp.post('/settings/providers', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({ provider: z.string(), api_key: z.string().min(1) })
      .parse(await c.req.json());
    const stub = await getAgentByName(c.env.UserSecretsStore as never, s.workspaceId);
    await (stub as any).setKey({ provider: body.provider, apiKey: body.api_key });
    return c.json({ ok: true });
  });

  apiApp.delete(
    '/settings/providers/:provider',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const stub = await getAgentByName(c.env.UserSecretsStore as never, s.workspaceId);
      await (stub as any).deleteKey(c.req.param('provider'));
      return c.json({ ok: true });
    },
  );
}
