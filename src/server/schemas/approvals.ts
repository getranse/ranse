import { z } from 'zod';

export const approveBody = z.object({
  edits: z.object({ subject: z.string().optional(), body_markdown: z.string().optional() }).optional(),
});

export const rejectBody = z.object({ reason: z.string().optional() });
