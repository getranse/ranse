import type { TranscriptMessage } from '../../../interfaces/memory';
import type { Env } from '../../env';
import { audit } from '../../actions/audit';
import { getText } from '../../../lib/storage';
import { infer } from '../../../lib/llm/infer';
import type { CustomerMemory, ExtractedFact } from '../../../types/shared/memory';
import { ingestExtractedFacts, listMemory } from '../../actions/memory';
import { ExtractionResult } from '../../schemas/memory-extract';
import { MAX_TRANSCRIPT_CHARS } from '../../../config/memory';

// LLM-driven distillation of durable customer facts from a resolved ticket.
// Triggers: ticket.resolved outcome event, or a periodic backfill job.
// Output is intentionally narrow — short factual statements, each tagged
// with a kind, each backed by the conversation it came from.

export async function extractMemoryFromTicket(
  env: Env,
  args: { workspaceId: string; ticketId: string },
): Promise<CustomerMemory[]> {
  const ticket = await env.DB.prepare(
    `SELECT id, customer_id, subject, status, requester_email, requester_name
       FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(args.ticketId, args.workspaceId)
    .first<{
      id: string;
      customer_id: string | null;
      subject: string;
      status: string;
      requester_email: string;
      requester_name: string | null;
    }>();
  if (!ticket?.customer_id) return [];
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') return [];

  const messages = await loadTranscript(env, args.workspaceId, args.ticketId);
  if (messages.length === 0) return [];
  const transcript = renderTranscript(messages);
  if (!transcript.trim()) return [];

  const existing = await listMemory(env, args.workspaceId, ticket.customer_id);
  const known = existing
    .slice(0, 12)
    .map((m) => `- (${m.kind}) ${m.fact_text}`)
    .join('\n');

  const result = await infer({
    env,
    action: 'summarize',
    metadata: { workspaceId: args.workspaceId, ticketId: args.ticketId },
    schema: ExtractionResult,
    schemaName: 'ExtractedCustomerMemory',
    system: extractionSystemPrompt(),
    user: `Customer: ${ticket.requester_name ?? ticket.requester_email}
Already-known facts (do not duplicate; only return new or updated facts):
${known || '(none)'}

Conversation transcript:
${transcript}`,
  }).catch((err) => {
    console.warn('memory extraction failed', err);
    return null;
  });

  const facts: ExtractedFact[] = (result?.data.facts ?? []).map((f) => ({
    kind: f.kind,
    text: f.text,
    confidence: f.confidence,
  }));
  if (facts.length === 0) return [];

  const ingested = await ingestExtractedFacts(env, {
    workspaceId: args.workspaceId,
    customerId: ticket.customer_id,
    sourceTicketId: args.ticketId,
    facts,
  });
  if (ingested.length > 0) {
    await audit(env, {
      workspaceId: args.workspaceId,
      ticketId: args.ticketId,
      actorType: 'agent',
      actorId: 'memory-extractor',
      action: 'customer_memory.extracted',
      payload: { count: ingested.length, customerId: ticket.customer_id },
    });
  }
  return ingested;
}

async function loadTranscript(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<TranscriptMessage[]> {
  const rows = await env.DB.prepare(
    `SELECT direction, from_address, sent_at, body_r2_key, preview
       FROM message_index
      WHERE workspace_id = ? AND ticket_id = ? AND direction IN ('inbound','outbound','note')
      ORDER BY sent_at ASC LIMIT 200`,
  )
    .bind(workspaceId, ticketId)
    .all<{
      direction: 'inbound' | 'outbound' | 'note';
      from_address: string | null;
      sent_at: number;
      body_r2_key: string | null;
      preview: string | null;
    }>();
  const messages: TranscriptMessage[] = [];
  for (const row of rows.results ?? []) {
    const body = row.body_r2_key ? await getText(env, row.body_r2_key) : null;
    messages.push({
      direction: row.direction,
      fromAddress: row.from_address,
      sentAt: row.sent_at,
      body: body ?? row.preview ?? '',
    });
  }
  return messages;
}

function renderTranscript(messages: TranscriptMessage[]): string {
  let total = 0;
  const lines: string[] = [];
  for (const msg of messages) {
    const role =
      msg.direction === 'inbound' ? 'CUSTOMER' : msg.direction === 'outbound' ? 'AGENT' : 'NOTE';
    const stamp = new Date(msg.sentAt).toISOString();
    const text = msg.body.replace(/\s+/g, ' ').trim().slice(0, 1_500);
    const line = `[${stamp}] ${role}: ${text}`;
    total += line.length;
    if (total > MAX_TRANSCRIPT_CHARS) break;
    lines.push(line);
  }
  return lines.join('\n');
}

function extractionSystemPrompt(): string {
  return [
    'You extract durable customer facts from a support conversation.',
    'Return ONLY facts that will still be useful on a future, unrelated ticket from the same customer.',
    'Each fact must be a short factual statement, less than 280 characters.',
    '',
    'Allowed kinds:',
    '- fact: a stable factual statement (e.g. "uses Enterprise plan", "lives in Tokyo").',
    '- preference: a stated preference (e.g. "prefers email over SMS", "uses she/her pronouns").',
    '- context: stable account or business context (e.g. "manages a team of 12 engineers").',
    '- complaint: a recurring pain point worth flagging (e.g. "has reported slow PDF export twice").',
    '- communication_style: how the customer prefers to be addressed (e.g. "first-name only, no formalities").',
    '',
    'Rules:',
    '- DO NOT extract one-off ticket details (single order ids, single dates, this-conversation context).',
    '- DO NOT extract sensitive PII (passwords, full card numbers, government ids).',
    '- DO NOT duplicate already-known facts. Skip them silently.',
    '- DO NOT speculate; if a fact is not stated clearly, omit it.',
    '- Each fact gets a confidence score in [0,1]. Use < 0.5 only if you are guessing — those rows will be dropped.',
  ].join('\n');
}
