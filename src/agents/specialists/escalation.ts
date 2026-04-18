import { z } from 'zod';
import type { Env } from '../../env';
import { infer } from '../../llm/infer';
import type { AgentConfig } from '../../llm/config.types';

export const EscalationResult = z.object({
  should_escalate: z.boolean(),
  reason: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  route_to: z.enum(['human_agent', 'on_call', 'billing_team', 'security_team', 'legal', 'none']),
});
export type EscalationResult = z.infer<typeof EscalationResult>;

export async function runEscalation(params: {
  env: Env;
  workspaceId: string;
  ticketId: string;
  ticketContext: string;
  workspaceConfig?: Partial<AgentConfig>;
}): Promise<EscalationResult> {
  const r = await infer({
    env: params.env,
    action: 'escalation',
    metadata: { workspaceId: params.workspaceId, ticketId: params.ticketId },
    workspaceConfig: params.workspaceConfig,
    schema: EscalationResult,
    schemaName: 'EscalationResult',
    system: `Decide whether a support ticket should be escalated. Be conservative — escalate on:
- threats of legal action, regulatory complaint, or press
- security/privacy/data-breach concerns
- explicit churn/cancellation risk from paying customers
- billing disputes above a trivial threshold
- hostile sentiment combined with unresolved issues
Return route_to='none' only if should_escalate=false.`,
    user: params.ticketContext.slice(0, 10_000),
  });
  return r.data;
}
