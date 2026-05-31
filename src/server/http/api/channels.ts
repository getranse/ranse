import type { Hono } from 'hono';
import { createPublicChannel, listPublicChannels, updatePublicChannel } from '../../inbox/channels';
import { apiError } from '../../../lib/errors';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';
import { channelBody, channelPatch } from '../../schemas/channels';

// All Phase 9 channels live behind one CRUD: the per-adapter config goes
// into `config` and is opaque to this route — the adapter validates it.

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
        kind: body.kind as never,
        mailboxId: body.mailbox_id,
        name: body.name,
        enabled: body.enabled,
        requireEmail: body.require_email,
        allowedOrigins: body.allowed_origins,
        welcomeMessage: body.welcome_message,
        config: body.config,
        slaFirstResponseMinutes: body.sla_first_response_minutes,
        slaResolutionMinutes: body.sla_resolution_minutes,
        defaultPriority: body.default_priority,
        defaultAssigneeUserId: body.default_assignee_user_id,
      });
      return c.json({ channel });
    } catch (err) {
      return mapChannelError(c, err);
    }
  });

  apiApp.patch('/channels/public/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = channelPatch.parse(await c.req.json());
    try {
      const channel = await updatePublicChannel(c.env, s.workspaceId, s.userId, c.req.param('id'), {
        name: body.name,
        enabled: body.enabled,
        requireEmail: body.require_email,
        allowedOrigins: body.allowed_origins,
        welcomeMessage: body.welcome_message,
        config: body.config,
        slaFirstResponseMinutes: body.sla_first_response_minutes,
        slaResolutionMinutes: body.sla_resolution_minutes,
        defaultPriority: body.default_priority,
        defaultAssigneeUserId: body.default_assignee_user_id,
      });
      if (!channel) return apiError(c, 'not_found', 'Channel not found.');
      return c.json({ channel });
    } catch (err) {
      return mapChannelError(c, err);
    }
  });
}

function mapChannelError(c: any, err: unknown): Response {
  if (err instanceof Error) {
    if (err.message === 'mailbox_not_found') {
      return apiError(c, 'not_found', 'Mailbox not found.');
    }
    if (err.message === 'channel_adapter_not_found' || err.message === 'unknown_channel_kind') {
      return apiError(c, 'validation_error', 'Unknown channel kind.', 400);
    }
    if (err.message.startsWith('config_invalid:')) {
      return apiError(c, 'validation_error', err.message.replace('config_invalid:', ''), 400);
    }
    if (err.message.startsWith('activation_failed:')) {
      return apiError(c, 'validation_error', err.message, 400);
    }
  }
  throw err;
}
