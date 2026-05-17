import type { Env } from '../../env';
import { audit } from '../../lib/audit';
import { agenticSearchKnowledge } from '../../knowledge';
import type { AgenticRetrievalTrace, KnowledgeInspectionHit } from '../../types/knowledge';
import { runDraft } from '../specialists/draft';
import type { workspaceConfig } from './settings';

export async function draftReply(
  env: Env,
  workspaceId: string,
  args: {
    ticketId: string;
    actorUserId: string;
  },
  resolveWorkspaceConfig: typeof workspaceConfig,
): Promise<{
  ok: boolean;
  subject?: string;
  body?: string;
  knowledge?: KnowledgeInspectionHit[];
  knowledgeTrace?: AgenticRetrievalTrace;
  error?: string;
}> {
  const t = await env.DB.prepare(
    `SELECT id, requester_email, subject FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(args.ticketId, workspaceId)
    .first<{ id: string; requester_email: string; subject: string }>();
  if (!t) return { ok: false, error: 'ticket_not_found' };

  const lastInbound = await env.DB.prepare(
    `SELECT from_address, subject, preview FROM message_index
      WHERE ticket_id = ? AND direction = 'inbound'
      ORDER BY sent_at DESC LIMIT 1`,
  )
    .bind(args.ticketId)
    .first<{ from_address: string | null; subject: string | null; preview: string | null }>();
  if (!lastInbound) return { ok: false, error: 'no_inbound_message_to_draft_from' };

  try {
    const cfg = await resolveWorkspaceConfig(env, workspaceId);
    const retrieval = await agenticSearchKnowledge(
      env,
      workspaceId,
      `${lastInbound.subject ?? t.subject}\n${lastInbound.preview ?? ''}`,
      { workspaceConfig: cfg, limit: 5, maxHops: 3 },
    );
    const draft = await runDraft({
      env,
      workspaceId,
      ticketId: args.ticketId,
      customerMessage: lastInbound.preview ?? '',
      customerName: undefined,
      knowledge: retrieval.hits,
      workspaceConfig: cfg,
    });
    await audit(env, {
      workspaceId,
      ticketId: args.ticketId,
      actorType: 'user',
      actorId: args.actorUserId,
      action: 'ai_draft.suggested',
    });
    return {
      ok: true,
      subject: `Re: ${(lastInbound.subject ?? t.subject).replace(/^(re:\s*)+/i, '')}`,
      body: draft.body_markdown,
      knowledge: retrieval.hits.map((hit) => ({
        ...hit,
        cited: draft.cites_knowledge_ids.includes(hit.id),
      })),
      knowledgeTrace: retrieval.trace,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'draft_failed' };
  }
}
