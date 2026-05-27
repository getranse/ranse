import type { Hono } from 'hono';
import { z } from 'zod';
import { createPublicChannel, listPublicChannels, updatePublicChannel } from '../../channels';
import { apiError } from '../../lib/errors';
import { PUBLIC_CHANNEL_KINDS } from '../../../types/channels';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

// All Phase 9 channels live behind one CRUD: the per-adapter config goes
// into `config` and is opaque to this route — the adapter validates it.

const kindSchema = z.enum(PUBLIC_CHANNEL_KINDS as unknown as [string, ...string[]]);
const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

const channelBody = z.object({
  kind: kindSchema,
  mailbox_id: z.string().min(1),
  name: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  require_email: z.boolean().optional(),
  allowed_origins: z.array(z.string().max(300)).max(20).optional(),
  welcome_message: z.string().max(240).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  sla_first_response_minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .nullable()
    .optional(),
  sla_resolution_minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .nullable()
    .optional(),
  default_priority: prioritySchema.nullable().optional(),
  default_assignee_user_id: z.string().min(1).max(120).nullable().optional(),
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
