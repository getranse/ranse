import type { Hono } from 'hono';
import { z } from 'zod';
import { createPublicChannel, listPublicChannels, updatePublicChannel } from '../channels';
import { apiError } from '../lib/errors';
import { OWNER_OR_ADMIN, requireWorkspaceRole, type Ctx } from './context';

const channelBody = z.object({
  kind: z.enum(['chat', 'form']),
  mailbox_id: z.string().min(1),
  name: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  require_email: z.boolean().optional(),
  allowed_origins: z.array(z.string().max(300)).max(20).optional(),
  welcome_message: z.string().max(240).nullable().optional(),
});

const channelPatch = channelBody.omit({ kind: true, mailbox_id: true }).partial();

export function registerChannelRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/channels/public', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json({ channels: await listPublicChannels(c.env, s.workspaceId) });
  });

  apiApp.post('/channels/public', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = channelBody.parse(await c.req.json());
    try {
      const channel = await createPublicChannel(c.env, s.workspaceId, s.userId, {
        kind: body.kind,
        mailboxId: body.mailbox_id,
        name: body.name,
        enabled: body.enabled,
        requireEmail: body.require_email,
        allowedOrigins: body.allowed_origins,
        welcomeMessage: body.welcome_message,
      });
      return c.json({ channel });
    } catch (err) {
      if (err instanceof Error && err.message === 'mailbox_not_found') {
        return apiError(c, 'not_found', 'Mailbox not found.');
      }
      throw err;
    }
  });

  apiApp.patch('/channels/public/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = channelPatch.parse(await c.req.json());
    const channel = await updatePublicChannel(c.env, s.workspaceId, s.userId, c.req.param('id'), {
      name: body.name,
      enabled: body.enabled,
      requireEmail: body.require_email,
      allowedOrigins: body.allowed_origins,
      welcomeMessage: body.welcome_message,
    });
    if (!channel) return apiError(c, 'not_found', 'Channel not found.');
    return c.json({ channel });
  });
}
