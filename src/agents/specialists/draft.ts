import { z } from 'zod';
import type { Env } from '../../env';
import { infer } from '../../llm/infer';
import type { AgentConfig } from '../../llm/config.types';
import type { KnowledgeHit } from './knowledge';

/**
 * Schema for AI-drafted replies. body_markdown is the only required field
 * — it's what populates the compose textarea. Every other field is
 * metadata used by the auto-draft → approval-queue path (risk scoring,
 * tone tagging, knowledge citation tracking) and gets a sensible default
 * when the model omits it. Workers AI Llama models don't reliably emit
 * full schema-conformant JSON on free-tier inference; OpenAI / Anthropic
 * models do. Treating the metadata as optional means a partial Llama
 * response still produces a usable draft instead of failing the whole
 * call.
 */
export const DraftResult = z.object({
  subject: z.string().default(''),
  body_markdown: z.string(),
  tone: z.enum(['friendly', 'formal', 'apologetic', 'informative']).default('friendly'),
  cites_knowledge_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  needs_human_review_reasons: z.array(z.string()).default([]),
});
export type DraftResult = z.infer<typeof DraftResult>;

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
  "cites_knowledge_ids": string[],   // ids you actually used; [] if none
  "confidence": number,        // 0..1
  "needs_human_review_reasons": string[]  // [] if none
}

Rules:
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
