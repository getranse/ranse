import { infer } from '../../../../lib/llm/infer';
import type { AgentConfig } from '../../../../types/server/llm';
import type { KnowledgeHit } from '../../../../types/shared/knowledge';
import type { Env } from '../../../env';
import { DraftResult } from '../../../schemas/draft';

export { DraftResult };

export async function runDraft(params: {
  env: Env;
  workspaceId: string;
  ticketId: string;
  customerMessage: string;
  customerName?: string;
  threadSummary?: string;
  knowledge: KnowledgeHit[];
  brandVoice?: string;
  macros?: Array<{ name: string; body: string }>;
  workspaceConfig?: Partial<AgentConfig>;
}): Promise<DraftResult> {
  const kb = params.knowledge
    .map((k, i) => `[${i + 1}] id=${k.id} title=${k.title}\n${k.snippet}`)
    .join('\n\n');
  const macros = (params.macros ?? []).map((m) => `- ${m.name}: ${m.body}`).join('\n');
  const r = await infer({
    env: params.env,
    action: 'draft',
    metadata: { workspaceId: params.workspaceId, ticketId: params.ticketId },
    workspaceConfig: params.workspaceConfig,
    schema: DraftResult,
    schemaName: 'DraftResult',
    system: `You are a support-agent drafting assistant. Draft a reply the human agent can approve.

Output a single JSON object with EXACTLY these fields and no others:
{
  "subject": string,           // Re: <original subject>
  "body_markdown": string,     // the reply, in markdown
  "tone": "friendly" | "formal" | "apologetic" | "informative",
  "language": string,          // ISO 639-1 code of the language the reply is written in
  "cites_knowledge_ids": string[],   // ids you actually used; [] if none
  "confidence": number,        // 0..1
  "needs_human_review_reasons": string[]  // [] if none
}

Rules:
- Write the reply in the customer's own language, and set "language" to its ISO 639-1 code.
- Address the customer by first name if known.
- Use brand voice if provided, otherwise warm and professional.
- Only cite knowledge_ids you actually used.
- If you don't know something, say so and flag it in needs_human_review_reasons.
- Never invent policies, prices, refund amounts, SLAs, or commitments.
- body_markdown is the actual reply — write the prose there.

Brand voice: ${params.brandVoice ?? 'friendly, concise, professional'}
Macros available:
${macros || '(none)'}`,
    user: `Customer: ${params.customerName ?? 'unknown'}
Thread summary: ${params.threadSummary ?? '(none)'}

Knowledge base hits:
${kb || '(no hits — rely on general support knowledge only)'}

Customer's latest message:
${params.customerMessage.slice(0, 8000)}`,
  });
  return r.data;
}
