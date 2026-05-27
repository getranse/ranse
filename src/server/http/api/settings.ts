import type { Hono } from 'hono';
import { z } from 'zod';
import { r2Keys, putRaw } from '../../lib/storage';
import { OWNER_OR_ADMIN, type Ctx, getSupervisor, requireWorkspaceRole } from './context';
import { readUploadedImage } from '../../lib/files';

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
        audit_read_logging: z.boolean().optional(),
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
}
