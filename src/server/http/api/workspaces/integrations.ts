import type { Hono } from 'hono';
import { apiError } from '../../../../lib/errors';
import { validatePublicHttpUrl } from '../../../../lib/url-security';
import { createApiToken, listApiTokens, revokeApiToken } from '../../../actions/api-tokens';
import { audit } from '../../../actions/audit';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
} from '../../../actions/webhooks';
import { createTokenBody, createWebhookBody } from '../../../schemas/integrations';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from '../context';

export function registerIntegrationRoutes(apiApp: Hono<Ctx>) {
  apiApp.use('/tokens/*', requireWorkspaceRole(OWNER_OR_ADMIN));
  apiApp.use('/tokens', requireWorkspaceRole(OWNER_OR_ADMIN));
  apiApp.use('/webhooks/*', requireWorkspaceRole(OWNER_OR_ADMIN));
  apiApp.use('/webhooks', requireWorkspaceRole(OWNER_OR_ADMIN));

  apiApp.get('/tokens', async (c) => {
    const s = c.get('session');
    return c.json({ tokens: await listApiTokens(c.env, s.workspaceId) });
  });

  apiApp.post('/tokens', async (c) => {
    const s = c.get('session');
    const body = createTokenBody.parse(await c.req.json());
    const { token, record } = await createApiToken(c.env, {
      workspaceId: s.workspaceId,
      name: body.name,
      role: body.role,
      createdBy: s.userId,
    });
    await audit(c.env, {
      workspaceId: s.workspaceId,
      actorType: 'user',
      actorId: s.userId,
      action: 'api_token.created',
      payload: { tokenId: record.id, name: record.name, role: record.role },
    });
    return c.json({ token, record });
  });

  apiApp.delete('/tokens/:id', async (c) => {
    const s = c.get('session');
    await revokeApiToken(c.env, s.workspaceId, c.req.param('id'));
    await audit(c.env, {
      workspaceId: s.workspaceId,
      actorType: 'user',
      actorId: s.userId,
      action: 'api_token.revoked',
      payload: { tokenId: c.req.param('id') },
    });
    return c.json({ ok: true });
  });

  apiApp.get('/webhooks', async (c) => {
    const s = c.get('session');
    return c.json({ webhooks: await listWebhookSubscriptions(c.env, s.workspaceId) });
  });

  apiApp.post('/webhooks', async (c) => {
    const s = c.get('session');
    const body = createWebhookBody.parse(await c.req.json());
    try {
      validatePublicHttpUrl(body.url, { httpsOnly: true });
    } catch {
      return apiError(c, 'invalid_url', 'Webhook URLs must be public HTTPS endpoints.');
    }
    const { subscription, secret } = await createWebhookSubscription(c.env, {
      workspaceId: s.workspaceId,
      url: body.url,
      events: body.events,
    });
    return c.json({ webhook: subscription, secret });
  });

  apiApp.delete('/webhooks/:id', async (c) => {
    const s = c.get('session');
    await deleteWebhookSubscription(c.env, s.workspaceId, c.req.param('id'));
    return c.json({ ok: true });
  });
}
