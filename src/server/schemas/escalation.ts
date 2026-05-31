import { z } from 'zod';

export const EscalationResult = z.object({
  should_escalate: z.boolean(),
  reason: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  route_to: z.enum(['human_agent', 'on_call', 'billing_team', 'security_team', 'legal', 'none']),
});
export type EscalationResult = z.infer<typeof EscalationResult>;
