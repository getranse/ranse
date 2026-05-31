import type { Env } from '../../../env';
import { infer } from '../../../../lib/llm/infer';
import type { AgentConfig } from '../../../../types/server/llm';
import { SummaryResult } from '../../../schemas/summarize';
export { SummaryResult };

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
