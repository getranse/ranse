import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import { setArticlePublic } from '../../actions/help-center';
import { setPublicBody } from '../../schemas/knowledge';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

export function registerKnowledgePublicRoutes(apiApp: Hono<Ctx>) {
  // Publishing a source to the help center is an owner/admin decision: it
  // exposes the content to the open internet.
  apiApp.patch('/knowledge/:id/public', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = setPublicBody.parse(await c.req.json());
    const ok = await setArticlePublic(c.env, s.workspaceId, c.req.param('id'), body.public);
    if (!ok) return apiError(c, 'not_found', 'Knowledge source not found.');
    return c.json({ ok: true });
  });
}
