import { z } from 'zod';
import { ASSIST_COMPLETION_MAX_CHARS } from '../../config/knowledge';

export const AssistResult = z.object({
  completion: z.string().max(ASSIST_COMPLETION_MAX_CHARS),
  confidence: z.number().min(0).max(1),
});
export type AssistResult = z.infer<typeof AssistResult>;
