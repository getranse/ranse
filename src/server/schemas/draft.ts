import { z } from 'zod';

/**
 * Schema for AI-drafted replies. body_markdown is the only required field
 * — it's what populates the compose textarea. Every other field is
 * metadata used by the auto-draft → approval-queue path (risk scoring,
 * tone tagging, knowledge citation tracking) and gets a sensible default
 * when the model omits it. Workers AI Llama models don't reliably emit
 * full schema-conformant JSON on free-tier inference; OpenAI / Anthropic
 * models do. Treating the metadata as optional means a partial Llama
 * response still produces a usable draft instead of failing the whole
 * call.
 */
export const DraftResult = z.object({
  subject: z.string().default(''),
  body_markdown: z.string(),
  tone: z.enum(['friendly', 'formal', 'apologetic', 'informative']).default('friendly'),
  cites_knowledge_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  needs_human_review_reasons: z.array(z.string()).default([]),
});
export type DraftResult = z.infer<typeof DraftResult>;
