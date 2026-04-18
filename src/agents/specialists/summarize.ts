import { z } from 'zod';
import type { Env } from '../../env';
import { infer } from '../../llm/infer';
import type { AgentConfig } from '../../llm/config.types';

export const SummaryResult = z.object({
  thread_summary: z.string(),
  customer_goal: z.string(),
  blockers: z.array(z.string()),
  next_step_hint: z.string(),
});
export type SummaryResult = z.infer<typeof SummaryResult>;

export async function runSummarize(params: {
  env: Env;
  workspaceId: string;
  ticketId: string;
  messages: Array<{ from: string; at: string; body: string }>;
  workspaceConfig?: Partial<AgentConfig>;
}): Promise<SummaryResult> {
  const transcript = params.messages
    .map((m) => `[${m.at}] ${m.from}:\n${m.body.slice(0, 4000)}`)
    .join('\n\n---\n\n');
  const r = await infer({
    env: params.env,
    action: 'summarize',
    metadata: { workspaceId: params.workspaceId, ticketId: params.ticketId },
    workspaceConfig: params.workspaceConfig,
    schema: SummaryResult,
    schemaName: 'SummaryResult',
    system: 'Summarize a customer-support thread for a human agent. Be factual and concise.',
    user: transcript,
  });
  return r.data;
}
