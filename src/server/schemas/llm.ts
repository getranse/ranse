import { z } from 'zod';
import { ACTION_KEYS, PROVIDERS } from '../../types/shared/llm';

export const llmConfigBody = z.object({
  action_key: z.enum(ACTION_KEYS),
  model_name: z.string().min(1),
  fallback_model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
});

export const providerKeyBody = z.object({ provider: z.string(), api_key: z.string().min(1) });

export const Provider = z.enum(PROVIDERS);
export type Provider = z.infer<typeof Provider>;

export const ModelSpec = z.object({
  provider: Provider,
  contextSize: z.number().int().positive(),
  nonReasoning: z.boolean().optional(),
  directOverride: z.boolean().optional(),
  supportsTools: z.boolean().default(true),
  supportsJsonSchema: z.boolean().default(true),
});
export type ModelSpec = z.infer<typeof ModelSpec>;
