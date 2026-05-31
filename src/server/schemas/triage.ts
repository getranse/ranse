import { z } from 'zod';

export const TriageResult = z.object({
  category: z.enum(['billing', 'technical', 'account', 'shipping', 'sales', 'feedback', 'spam', 'other']).default('other'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'hostile']).default('neutral'),
  language: z.string().default('en').describe('ISO 639-1 language code, e.g. "en"'),
  summary: z.string().default('').describe('One-sentence summary of the request'),
  tags: z.array(z.string()).max(5).default([]),
  suggested_auto_reply_allowed: z.boolean().default(false),
});
export type TriageResult = z.infer<typeof TriageResult>;
