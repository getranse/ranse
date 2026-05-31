import type { Env } from '../../../env';
import { infer } from '../../../../lib/llm/infer';
import type { AgentConfig } from '../../../../types/server/llm';
import { TriageResult } from '../../../schemas/triage';
export { TriageResult };

export async function runTriage(params: {
  env: Env;
  workspaceId: string;
  ticketId: string;
  subject: string;
  body: string;
  from: string;
  workspaceConfig?: Partial<AgentConfig>;
}): Promise<TriageResult> {
  const result = await infer({
    env: params.env,
    action: 'triage',
    metadata: { workspaceId: params.workspaceId, ticketId: params.ticketId },
    workspaceConfig: params.workspaceConfig,
    schema: TriageResult,
    schemaName: 'TriageResult',
    system: `You are a support-inbox triage assistant. Classify incoming customer emails. Be decisive.
Return strict JSON matching the schema. Do not invent facts. If the message is marketing/spam, set category="spam".`,
    user: `From: ${params.from}
Subject: ${params.subject}

${params.body.slice(0, 8000)}`,
  });
  return result.data;
}
