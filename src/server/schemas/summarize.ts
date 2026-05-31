import { z } from 'zod';

export const SummaryResult = z.object({
  thread_summary: z.string(),
  customer_goal: z.string(),
  blockers: z.array(z.string()),
  next_step_hint: z.string(),
});
export type SummaryResult = z.infer<typeof SummaryResult>;
