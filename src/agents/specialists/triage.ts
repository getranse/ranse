import { z } from 'zod';
import type { Env } from '../../env';
import { infer } from '../../llm/infer';
import type { AgentConfig } from '../../llm/config.types';

export const TriageResult = z.object({
  category: z.enum(['billing', 'technical', 'account', 'shipping', 'sales', 'feedback', 'spam', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'hostile']),
  language: z.string().describe('ISO 639-1 language code, e.g. "en"'),
  summary: z.string().describe('One-sentence summary of the request'),
  tags: z.array(z.string()).max(5),
  suggested_auto_reply_allowed: z.boolean(),
});
export type TriageResult = z.infer<typeof TriageResult>;

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
