import { z } from 'zod';
import { EVENT_NAMES } from '../inbox/notifications/events';

export const createTokenBody = z.object({
  name: z.string().min(1).max(64),
  role: z.enum(['admin', 'agent', 'viewer']).default('agent'),
});

export const createWebhookBody = z.object({
  url: z.string().url().startsWith('https://'),
  events: z
    .array(z.enum(EVENT_NAMES as [string, ...string[]]))
    .min(1)
    .max(EVENT_NAMES.length),
});
