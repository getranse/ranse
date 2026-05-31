import { z } from 'zod';
import { EVENT_NAMES, type EventName } from '../inbox/notifications/events';
import { CHANNEL_KINDS } from '../inbox/notifications/channels';

export const createChannelBody = z.object({
  kind: z.enum(CHANNEL_KINDS as [string, ...string[]]),
  target: z.string().min(1).max(2000),
  events: z.array(z.enum(EVENT_NAMES as [EventName, ...EventName[]])).min(1),
  label: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
});

export const patchChannelBody = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.enum(EVENT_NAMES as [EventName, ...EventName[]])).min(1).optional(),
  label: z.string().max(100).nullable().optional(),
});
