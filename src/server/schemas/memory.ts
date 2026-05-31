import { z } from 'zod';

export const createBody = z.object({
  customer_id: z.string().min(1),
  fact_text: z.string().min(2).max(600),
  kind: z
    .enum(['fact', 'preference', 'context', 'complaint', 'communication_style'])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const redactBody = z.object({ reason: z.string().min(2).max(240) });
