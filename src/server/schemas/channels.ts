import { z } from 'zod';
import { PUBLIC_CHANNEL_KINDS } from '../../types/shared/channels';

const kindSchema = z.enum(PUBLIC_CHANNEL_KINDS as unknown as [string, ...string[]]);
const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const channelBody = z.object({
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

export const channelPatch = channelBody.omit({ kind: true, mailbox_id: true }).partial();
