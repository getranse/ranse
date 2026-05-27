import { z } from 'zod';
import type { Env } from '../../env';
import { searchKnowledge } from '../../knowledge';
import type { AgentConfig } from '../../llm/config.types';
import { infer } from '../../llm/infer';
import type { KnowledgeHit } from '../../../types/knowledge';

// Real-time operator copilot. While the operator is typing a reply, the
// composer calls this endpoint with the current draft + cursor; we return
// a short completion suggestion (ghost text), the top KB hits that ground
// the suggestion, and similar past tickets the operator might want to
// reuse from.
//
// Designed for speed, not depth: uses the fast LLM action, never the
// reasoning-heavy `draft` action. The full agentic-retrieval pipeline runs
// only when the operator clicks "Draft with AI" — not on every keystroke.

const COMPLETION_MAX_CHARS = 220;
const KB_HITS = 4;
const PAST_TICKETS = 3;

const AssistResult = z.object({
  completion: z.string().max(COMPLETION_MAX_CHARS),
  confidence: z.number().min(0).max(1),
});

export interface DraftAssistInput {
  draftText: string;
  cursor?: number;
}

export interface SimilarTicket {
  id: string;
  subject: string;
  resolved_at: number | null;
  preview: string | null;
}

export interface DraftAssistResult {
  completion: string;
  confidence: number;
  knowledge: KnowledgeHit[];
  similar: SimilarTicket[];
  model: string;
}

export async function runDraftAssist(params: {
  env: Env;
  workspaceId: string;
  ticketId: string;
  ticketSubject: string;
  customerLastMessage: string;
  customerMemoryFacts?: string[];
  draft: DraftAssistInput;
  workspaceConfig?: Partial<AgentConfig>;
}): Promise<DraftAssistResult> {
  const draftLeft = trimDraftToCursor(params.draft.draftText, params.draft.cursor);
  if (draftLeft.replace(/\s/g, '').length < 2) {
    return { completion: '', confidence: 0, knowledge: [], similar: [], model: '' };
  }

  // Two cheap parallel reads to keep p95 under ~400ms: KB hits + past
  // ticket lookups. Both narrow on the customer's last message + the
  // operator's draft so far, since the draft conveys intent the inbound
  // message alone might not.
  const grounding = `${params.customerLastMessage}\n\n[operator drafting]: ${draftLeft.slice(-400)}`;
  const [knowledge, similar] = await Promise.all([
    searchKnowledge(params.env, params.workspaceId, grounding, KB_HITS).catch(() => []),
    findSimilarTickets(params.env, params.workspaceId, params.ticketId, params.ticketSubject),
  ]);

  const groundingNotes = knowledge
    .slice(0, 3)
    .map((hit, idx) => `[KB${idx + 1}] ${hit.title}\n${hit.snippet.slice(0, 600)}`)
    .join('\n\n');
  const memoryNotes = (params.customerMemoryFacts ?? []).slice(0, 5).join('\n- ');

  const r = await infer({
    env: params.env,
    action: 'summarize',
    metadata: { workspaceId: params.workspaceId, ticketId: params.ticketId },
    workspaceConfig: params.workspaceConfig,
    schema: AssistResult,
    schemaName: 'DraftAssistResult',
    system: assistSystemPrompt(),
    user: assistUserPrompt({
      ticketSubject: params.ticketSubject,
      customerMessage: params.customerLastMessage,
      memoryNotes,
      groundingNotes,
      draftLeft,
    }),
  }).catch(() => null);

  return {
    completion: r?.data.completion ?? '',
    confidence: r?.data.confidence ?? 0,
    knowledge,
    similar,
    model: r?.model ?? '',
  };
}

async function findSimilarTickets(
  env: Env,
  workspaceId: string,
  excludeTicketId: string,
  subject: string,
): Promise<SimilarTicket[]> {
  // Tickets with overlapping subject keywords + resolved within the last
  // 90 days. Lightweight LIKE-based ranking; the vector path would be
  // better but adds latency we don't want on the keystroke loop.
  const keywords = subject
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 4);
  if (keywords.length === 0) return [];
  const since = Date.now() - 90 * 24 * 60 * 60_000;
  const pattern = `%${keywords[0]}%`;
  const rows = await env.DB.prepare(
    `SELECT t.id, t.subject, t.updated_at,
            (SELECT preview FROM message_index WHERE ticket_id = t.id AND direction = 'outbound'
              ORDER BY sent_at DESC LIMIT 1) AS preview
       FROM ticket t
      WHERE t.workspace_id = ? AND t.id != ? AND t.status IN ('resolved','closed')
        AND t.updated_at >= ?
        AND LOWER(t.subject) LIKE ?
      ORDER BY t.updated_at DESC LIMIT ?`,
  )
    .bind(workspaceId, excludeTicketId, since, pattern, PAST_TICKETS)
    .all<{ id: string; subject: string; updated_at: number; preview: string | null }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    subject: r.subject,
    resolved_at: r.updated_at,
    preview: r.preview,
  }));
}

function trimDraftToCursor(text: string, cursor?: number): string {
  if (cursor === undefined) return text;
  return text.slice(0, Math.max(0, Math.min(cursor, text.length)));
}

function assistSystemPrompt(): string {
  return [
    'You are a real-time writing assistant for a customer-support operator.',
    'They are mid-sentence. Suggest at most ONE sentence that naturally continues their draft.',
    '',
    'Rules:',
    '- Keep the suggestion under 30 words.',
    '- Match the tone the operator has set (formal, friendly, terse).',
    '- Cite only facts that appear in the customer message, the KB excerpts, or the customer memory.',
    '- Never invent prices, refund amounts, dates, account ids, or policy details.',
    '- Never include greetings or sign-offs — they are already handled.',
    '- If the draft is already complete or the next word is obvious filler, return an empty completion and confidence 0.',
    '- Confidence ranges: 0.0 (do not show), 0.4 (weak hint), 0.7 (good completion), 0.9 (KB-grounded continuation).',
  ].join('\n');
}

function assistUserPrompt(args: {
  ticketSubject: string;
  customerMessage: string;
  memoryNotes: string;
  groundingNotes: string;
  draftLeft: string;
}): string {
  return [
    `Subject: ${args.ticketSubject}`,
    '',
    'Customer message:',
    args.customerMessage.slice(0, 2_000),
    args.memoryNotes ? `\nKnown about this customer:\n- ${args.memoryNotes}` : '',
    args.groundingNotes ? `\nRelevant KB excerpts:\n${args.groundingNotes}` : '',
    '',
    'Operator draft so far (continue from the end):',
    args.draftLeft.slice(-1_500),
  ]
    .filter(Boolean)
    .join('\n');
}
