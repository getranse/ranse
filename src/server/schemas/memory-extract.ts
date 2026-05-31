import { z } from 'zod';
import { MAX_FACTS_PER_TICKET } from '../../config/memory';
export { MAX_FACTS_PER_TICKET };

export const ExtractionResult = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(['fact', 'preference', 'context', 'complaint', 'communication_style']),
        text: z.string().min(8).max(280),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(MAX_FACTS_PER_TICKET),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;
