import type { Env } from '../env';
import { audit } from '../lib/audit';
import { sha256Hex } from '../lib/crypto';
import { ids } from '../lib/ids';
import { ingestKnowledgeSource } from '../knowledge';
import type {
  ConversationScore,
  InsightSummary,
  KbSuggestion,
  KbSuggestionStatus,
  KnowledgeDriftSignal,
  KnowledgeDriftStatus,
} from '../types/insights';

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'could',
  'customer',
  'does',
  'done',
  'for',
  'from',
  'get',
  'have',
  'help',
  'how',
  'into',
  'just',
  'need',
  'order',
  'please',
  'request',
  'send',
  'support',
  'that',
  'their',
  'there',
  'this',
  'ticket',
  'what',
  'when',
  'where',
  'with',
  'your',
]);

const MIN_SUGGESTION_TICKETS = 2;
const MIN_DRIFT_REPLIES = 2;
const MAX_SOURCE_CHUNKS_FOR_LINEAGE = 50;

interface TicketRow {
  id: string;
  workspace_id: string;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  requester_email: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  ticket_id: string;
  workspace_id: string;
  direction: 'inbound' | 'outbound' | 'note';
  preview: string | null;
  sent_at: number;
  created_at: number;
}

interface ApprovalRow {
  kind: string;
  status: string;
  proposed_json: string;
  risk_reasons_json: string;
  created_at: number;
}

interface OutcomeRow {
  kind: string;
  confidence_score: number | null;
  payload_json: string;
  created_at: number;
}

interface FeedbackRow {
  rating: 'positive' | 'negative';
  source: string;
  comment: string | null;
  created_at: number;
}

export async function scoreWorkspaceConversations(
  env: Env,
  workspaceId: string,
  limit = 100,
): Promise<{ scored: number; scores: ConversationScore[] }> {
  const rows = await env.DB.prepare(
    `SELECT id FROM ticket
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, Math.min(Math.max(limit, 1), 500))
    .all<{ id: string }>();
  const scores: ConversationScore[] = [];
  for (const row of rows.results ?? []) {
    const score = await scoreConversation(env, workspaceId, row.id);
    if (score) scores.push(score);
  }
  return { scored: scores.length, scores };
}

export async function scoreConversation(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<ConversationScore | null> {
  const ticket = await getTicket(env, workspaceId, ticketId);
  if (!ticket) return null;
  const [messages, approvals, outcomes, feedback] = await Promise.all([
    listMessages(env, workspaceId, ticketId),
    listApprovals(env, workspaceId, ticketId),
    listOutcomes(env, workspaceId, ticketId),
    listFeedback(env, workspaceId, ticketId),
  ]);
  const inbound = messages.filter((msg) => msg.direction === 'inbound');
  const outbound = messages.filter((msg) => msg.direction === 'outbound');
  const proposed = approvals.map((approval) => safeJson(approval.proposed_json));
  const citedIds = new Set<string>();
  let proposedConfidence = 0;
  let groundedTrace = false;
  let hasKnowledgeHits = false;
  for (const item of proposed) {
    for (const cited of asStringArray(item.cites_knowledge_ids)) citedIds.add(cited);
    proposedConfidence = Math.max(proposedConfidence, numberOrZero(item.confidence));
    groundedTrace = groundedTrace || hasFinalAnswerableTrace(item.knowledge_trace);
    hasKnowledgeHits =
      hasKnowledgeHits || (Array.isArray(item.knowledge_hits) && item.knowledge_hits.length > 0);
  }
  const risks = approvals.flatMap((approval) =>
    asStringArray(safeJson(approval.risk_reasons_json)),
  );
  const outcomeKinds = new Set(outcomes.map((outcome) => outcome.kind));
  const hasPositiveFeedback = feedback.some((item) => item.rating === 'positive');
  const hasNegativeFeedback = feedback.some((item) => item.rating === 'negative');
  const escalated = outcomeKinds.has('escalated');
  const followedUp = outcomeKinds.has('customer_followed_up');

  const groundedness = scoreGroundedness({
    hasOutbound: outbound.length > 0,
    citedCount: citedIds.size,
    proposedConfidence,
    groundedTrace,
    hasKnowledgeHits,
    risks,
  });
  const tone = scoreTone(outbound.map((msg) => msg.preview ?? '').join('\n'));
  const resolution = scoreResolution(ticket.status, {
    resolvedByOutcome:
      outcomeKinds.has('resolved_autonomously') || outcomeKinds.has('resolved_via_procedure'),
    escalated,
    followedUp,
    hasPositiveFeedback,
    hasNegativeFeedback,
  });
  const effort = scoreEffort({
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    escalated,
    followedUp,
    pendingApprovals: approvals.filter((approval) => approval.status === 'pending').length,
  });
  const overall = weightedScore({ groundedness, tone, resolution, effort });
  const now = Date.now();
  const signals = {
    inbound_count: inbound.length,
    outbound_count: outbound.length,
    cited_knowledge_count: citedIds.size,
    proposed_confidence: proposedConfidence || null,
    risk_reasons: unique(risks),
    outcome_kinds: [...outcomeKinds],
    feedback: feedback.map((item) => ({ rating: item.rating, source: item.source })),
  };
  await env.DB.prepare(
    `INSERT INTO conversation_score (
       id, workspace_id, ticket_id, groundedness_score, tone_score, resolution_score,
       effort_score, overall_score, signals_json, scored_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, ticket_id) DO UPDATE SET
       groundedness_score = excluded.groundedness_score,
       tone_score = excluded.tone_score,
       resolution_score = excluded.resolution_score,
       effort_score = excluded.effort_score,
       overall_score = excluded.overall_score,
       signals_json = excluded.signals_json,
       scored_at = excluded.scored_at,
       updated_at = excluded.updated_at`,
  )
    .bind(
      ids.conversationScore(),
      workspaceId,
      ticketId,
      groundedness,
      tone,
      resolution,
      effort,
      overall,
      JSON.stringify(signals),
      now,
      now,
    )
    .run();
  return (await getConversationScore(env, workspaceId, ticketId))!;
}

export async function listConversationScores(
  env: Env,
  workspaceId: string,
  limit = 50,
): Promise<ConversationScore[]> {
  const rows = await env.DB.prepare(
    `SELECT s.*, t.subject, t.status, t.category
       FROM conversation_score s
       JOIN ticket t ON t.id = s.ticket_id AND t.workspace_id = s.workspace_id
      WHERE s.workspace_id = ?
      ORDER BY s.overall_score ASC, s.scored_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, Math.min(Math.max(limit, 1), 200))
    .all<ConversationScore>();
  return rows.results ?? [];
}

export async function getInsightSummary(
  env: Env,
  workspaceId: string,
  days = 30,
): Promise<InsightSummary> {
  const rangeDays = Math.min(Math.max(days, 1), 365);
  const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const [ticketRows, outcomes, feedback, scoreRows, unresolved, procedures] = await Promise.all([
    env.DB.prepare(`SELECT status FROM ticket WHERE workspace_id = ? AND created_at >= ?`)
      .bind(workspaceId, since)
      .all<{ status: string }>(),
    env.DB.prepare(
      `SELECT kind, payload_json FROM ticket_outcome_event
        WHERE workspace_id = ? AND created_at >= ?`,
    )
      .bind(workspaceId, since)
      .all<{ kind: string; payload_json: string }>(),
    env.DB.prepare(`SELECT rating FROM ticket_feedback WHERE workspace_id = ? AND created_at >= ?`)
      .bind(workspaceId, since)
      .all<{ rating: 'positive' | 'negative' }>(),
    env.DB.prepare(
      `SELECT s.groundedness_score, s.tone_score, s.resolution_score, s.effort_score, s.overall_score
         FROM conversation_score s
         JOIN ticket t ON t.id = s.ticket_id AND t.workspace_id = s.workspace_id
        WHERE s.workspace_id = ? AND t.created_at >= ?`,
    )
      .bind(workspaceId, since)
      .all<
        Pick<
          ConversationScore,
          | 'groundedness_score'
          | 'tone_score'
          | 'resolution_score'
          | 'effort_score'
          | 'overall_score'
        >
      >(),
    env.DB.prepare(
      `SELECT id, subject, category, status FROM ticket
        WHERE workspace_id = ? AND status IN ('open','pending') AND updated_at >= ?
        ORDER BY updated_at DESC LIMIT 200`,
    )
      .bind(workspaceId, since)
      .all<{ id: string; subject: string; category: string | null; status: string }>(),
    env.DB.prepare(
      `SELECT p.id AS procedure_id, p.slug, p.name, r.status,
              COALESCE(r.completed_at, r.updated_at) - COALESCE(r.started_at, r.created_at) AS duration_ms
         FROM procedure_run r
         JOIN "procedure" p ON p.id = r.procedure_id AND p.workspace_id = r.workspace_id
        WHERE r.workspace_id = ? AND r.created_at >= ?`,
    )
      .bind(workspaceId, since)
      .all<{
        procedure_id: string;
        slug: string;
        name: string;
        status: string;
        duration_ms: number;
      }>(),
  ]);

  const tickets = ticketRows.results ?? [];
  const outcomeRows = outcomes.results ?? [];
  const feedbackRows = feedback.results ?? [];
  const resolved = tickets.filter(
    (ticket) => ticket.status === 'resolved' || ticket.status === 'closed',
  ).length;
  return {
    range_days: rangeDays,
    ticket_count: tickets.length,
    resolved_ticket_count: resolved,
    resolution_rate: tickets.length ? round4(resolved / tickets.length) : 0,
    open_ticket_count: tickets.filter((ticket) => ticket.status === 'open').length,
    pending_ticket_count: tickets.filter((ticket) => ticket.status === 'pending').length,
    escalated_count: outcomeRows.filter((outcome) => outcome.kind === 'escalated').length,
    customer_followed_up_count: outcomeRows.filter(
      (outcome) => outcome.kind === 'customer_followed_up',
    ).length,
    positive_feedback_count: feedbackRows.filter((item) => item.rating === 'positive').length,
    negative_feedback_count: feedbackRows.filter((item) => item.rating === 'negative').length,
    avg_groundedness_score: averageScore(scoreRows.results ?? [], 'groundedness_score'),
    avg_tone_score: averageScore(scoreRows.results ?? [], 'tone_score'),
    avg_resolution_score: averageScore(scoreRows.results ?? [], 'resolution_score'),
    avg_effort_score: averageScore(scoreRows.results ?? [], 'effort_score'),
    avg_overall_score: averageScore(scoreRows.results ?? [], 'overall_score'),
    escalation_reasons: topCounts(
      outcomeRows
        .filter((outcome) => outcome.kind === 'escalated')
        .map((outcome) => escalationReason(safeJson(outcome.payload_json))),
      8,
    ).map(([reason, count]) => ({ reason, count })),
    top_unresolved_intents: topUnresolvedIntents(unresolved.results ?? []),
    slowest_procedures: slowestProcedures(procedures.results ?? []),
  };
}

export async function generateKbSuggestions(
  env: Env,
  workspaceId: string,
  limit = 100,
): Promise<{ generated: number; suggestions: KbSuggestion[] }> {
  const tickets = await env.DB.prepare(
    `SELECT id, subject, category, status, updated_at
       FROM ticket
      WHERE workspace_id = ? AND status IN ('open','pending')
      ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(workspaceId, Math.min(Math.max(limit, 1), 300))
    .all<{
      id: string;
      subject: string;
      category: string | null;
      status: string;
      updated_at: number;
    }>();
  const idsByIntent = new Map<string, Array<{ id: string; subject: string }>>();
  for (const ticket of tickets.results ?? []) {
    const intent = inferTicketIntent(ticket.category, ticket.subject);
    if (!intent) continue;
    const rows = idsByIntent.get(intent) ?? [];
    rows.push({ id: ticket.id, subject: ticket.subject });
    idsByIntent.set(intent, rows);
  }

  const suggestions: KbSuggestion[] = [];
  const eligibleClusters = [...idsByIntent.entries()]
    .filter(([, rows]) => rows.length >= MIN_SUGGESTION_TICKETS)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 10);
  for (const [intent, rows] of eligibleClusters) {
    const clusterKey = `unresolved:${await sha256Hex(intent.toLowerCase())}`;
    const sourceTicketIds = rows.slice(0, 20).map((row) => row.id);
    const terms = topTerms(rows.map((row) => row.subject).join(' '), 12);
    const confidence = suggestionConfidence(rows.length, terms.length);
    const title = `Document ${humanizeIntent(intent)}`;
    const body = [
      `# ${title}`,
      '',
      '## Evidence',
      `- Unresolved conversations: ${rows.length}`,
      `- Suggested terms: ${terms.join(', ') || 'none'}`,
      `- Confidence: ${Math.round(confidence * 100)}%`,
      '',
      '## Customer questions to cover',
      ...rows.slice(0, 6).map((row) => `- ${row.subject}`),
      '',
      '## Draft answer',
      'Add the approved support policy, required customer details, edge cases, and escalation rules here before publishing.',
      '',
      '## Source tickets',
      ...sourceTicketIds.map((ticketId) => `- ${ticketId}`),
    ].join('\n');
    await upsertKbSuggestion(env, workspaceId, {
      clusterKey,
      title,
      summary: `${rows.length} unresolved ${humanizeIntent(intent).toLowerCase()} conversation${rows.length === 1 ? '' : 's'} need a reusable answer.`,
      body,
      sourceTicketIds,
      terms,
      confidence,
    });
    const suggestion = await getKbSuggestionByCluster(env, workspaceId, clusterKey);
    if (suggestion?.status === 'open') suggestions.push(suggestion);
  }
  return { generated: suggestions.length, suggestions };
}

export async function listKbSuggestions(
  env: Env,
  workspaceId: string,
  status?: KbSuggestionStatus,
): Promise<KbSuggestion[]> {
  const where = status ? 'WHERE workspace_id = ? AND status = ?' : 'WHERE workspace_id = ?';
  const rows = await env.DB.prepare(
    `SELECT * FROM kb_suggestion ${where} ORDER BY updated_at DESC LIMIT 100`,
  )
    .bind(...(status ? [workspaceId, status] : [workspaceId]))
    .all<KbSuggestion>();
  return rows.results ?? [];
}

export async function updateKbSuggestionStatus(
  env: Env,
  workspaceId: string,
  suggestionId: string,
  status: Exclude<KbSuggestionStatus, 'accepted'>,
  actorUserId?: string,
): Promise<KbSuggestion | null> {
  const current = await getKbSuggestion(env, workspaceId, suggestionId);
  if (!current) return null;
  if (current.status === 'accepted') {
    throw new Error('kb_suggestion_accepted');
  }
  await env.DB.prepare(
    `UPDATE kb_suggestion SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(status, Date.now(), suggestionId, workspaceId)
    .run();
  const suggestion = await getKbSuggestion(env, workspaceId, suggestionId);
  if (suggestion) {
    await audit(env, {
      workspaceId,
      actorType: actorUserId ? 'user' : 'system',
      actorId: actorUserId,
      action: 'insights.kb_suggestion_status_updated',
      payload: { suggestionId, status },
    });
  }
  return suggestion;
}

export async function acceptKbSuggestion(
  env: Env,
  workspaceId: string,
  suggestionId: string,
  actorUserId?: string,
): Promise<{ suggestion: KbSuggestion; sourceId: string } | null> {
  const suggestion = await getKbSuggestion(env, workspaceId, suggestionId);
  if (!suggestion) return null;
  if (suggestion.status === 'accepted' && suggestion.accepted_source_id) {
    return { suggestion, sourceId: suggestion.accepted_source_id };
  }
  if (suggestion.status !== 'open') throw new Error('kb_suggestion_not_open');
  const sourceId = sourceIdForSuggestion(suggestion.id);
  const result = await ingestKnowledgeSource(env, workspaceId, {
    kind: 'manual',
    title: suggestion.title,
    body: suggestion.body_markdown,
    sourceId,
  });
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE kb_suggestion
        SET status = 'accepted',
            accepted_source_id = ?,
            accepted_by_user_id = ?,
            accepted_at = ?,
            updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(result.sourceId, actorUserId ?? null, now, now, suggestionId, workspaceId)
    .run();
  const updated = await getKbSuggestion(env, workspaceId, suggestionId);
  await audit(env, {
    workspaceId,
    actorType: actorUserId ? 'user' : 'system',
    actorId: actorUserId,
    action: 'insights.kb_suggestion_accepted',
    payload: { suggestionId, sourceId: result.sourceId },
  });
  return updated ? { suggestion: updated, sourceId: result.sourceId } : null;
}

export async function detectKnowledgeDrift(
  env: Env,
  workspaceId: string,
): Promise<{ detected: number; signals: KnowledgeDriftSignal[] }> {
  const sources = await env.DB.prepare(
    `SELECT s.id, s.title, COALESCE(SUM(c.used_in_answers_count), 0) AS used_count
       FROM knowledge_source s
       LEFT JOIN knowledge_chunk c ON c.source_id = s.id AND c.workspace_id = s.workspace_id
      WHERE s.workspace_id = ? AND s.status = 'ready'
      GROUP BY s.id
      HAVING COALESCE(SUM(c.used_in_answers_count), 0) > 0
      ORDER BY used_count DESC, s.updated_at DESC LIMIT 50`,
  )
    .bind(workspaceId)
    .all<{ id: string; title: string; used_count: number }>();
  const signals: KnowledgeDriftSignal[] = [];
  for (const source of sources.results ?? []) {
    const sourceChunks = await sourceChunksForDrift(env, workspaceId, source.id);
    const sourceBody = sourceChunks.map((chunk) => chunk.body).join('\n\n');
    if (!sourceBody.trim()) continue;
    const citedTicketIds = await citedTicketIdsForSource(
      env,
      workspaceId,
      sourceChunks.map((chunk) => chunk.id),
    );
    const replies = await successfulReplyCorpus(env, workspaceId, citedTicketIds);
    if (replies.length < MIN_DRIFT_REPLIES) continue;
    const replyTerms = termCounts(replies.map((reply) => reply.preview).join(' '));
    const sourceTerms = new Set(topTerms(sourceBody, 200));
    const divergent = [...replyTerms.entries()]
      .filter(([term, count]) => count >= 2 && !sourceTerms.has(term))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([term]) => term);
    if (divergent.length < 3) continue;
    const signalHash = await sha256Hex(`${source.id}:${divergent.join('|')}`);
    const severity = divergent.length >= 8 ? 'high' : divergent.length >= 5 ? 'medium' : 'low';
    await upsertDriftSignal(env, workspaceId, {
      sourceId: source.id,
      signalHash,
      severity,
      title: `${source.title} may be drifting`,
      summary: `Recent successful replies mention terms not covered by this source: ${divergent.slice(0, 5).join(', ')}.`,
      successfulReplyCount: replies.length,
      divergenceTerms: divergent,
      exampleTicketIds: unique(replies.map((reply) => reply.ticket_id)).slice(0, 10),
    });
    const signal = await getDriftSignalByHash(env, workspaceId, source.id, signalHash);
    if (signal?.status === 'open') signals.push(signal);
  }
  return { detected: signals.length, signals };
}

export async function listKnowledgeDriftSignals(
  env: Env,
  workspaceId: string,
  status?: KnowledgeDriftStatus,
): Promise<KnowledgeDriftSignal[]> {
  const where = status ? 'WHERE workspace_id = ? AND status = ?' : 'WHERE workspace_id = ?';
  const rows = await env.DB.prepare(
    `SELECT * FROM knowledge_drift_signal ${where}
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, detected_at DESC
      LIMIT 100`,
  )
    .bind(...(status ? [workspaceId, status] : [workspaceId]))
    .all<KnowledgeDriftSignal>();
  return rows.results ?? [];
}

export async function updateKnowledgeDriftStatus(
  env: Env,
  workspaceId: string,
  signalId: string,
  status: KnowledgeDriftStatus,
  actorUserId?: string,
): Promise<KnowledgeDriftSignal | null> {
  await env.DB.prepare(
    `UPDATE knowledge_drift_signal SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(status, Date.now(), signalId, workspaceId)
    .run();
  const signal = await getDriftSignal(env, workspaceId, signalId);
  if (signal) {
    await audit(env, {
      workspaceId,
      actorType: actorUserId ? 'user' : 'system',
      actorId: actorUserId,
      action: 'insights.knowledge_drift_status_updated',
      payload: { signalId, status },
    });
  }
  return signal;
}

export async function runWorkspaceInsightsMaintenance(
  env: Env,
  workspaceId: string,
): Promise<{ scored: number; suggestions: number; drift: number }> {
  const [scores, suggestions, drift] = await Promise.all([
    scoreWorkspaceConversations(env, workspaceId, 200),
    generateKbSuggestions(env, workspaceId, 200),
    detectKnowledgeDrift(env, workspaceId),
  ]);
  return { scored: scores.scored, suggestions: suggestions.generated, drift: drift.detected };
}

export async function runAllWorkspaceInsightsMaintenance(
  env: Env,
): Promise<Array<{ workspaceId: string; scored: number; suggestions: number; drift: number }>> {
  const rows = await env.DB.prepare(
    `SELECT id FROM workspace WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at ASC`,
  ).all<{ id: string }>();
  const results = [];
  for (const row of rows.results ?? []) {
    const result = await runWorkspaceInsightsMaintenance(env, row.id);
    results.push({ workspaceId: row.id, ...result });
  }
  return results;
}

async function getTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<TicketRow | null> {
  return env.DB.prepare(
    `SELECT id, workspace_id, subject, status, priority, category, requester_email, created_at, updated_at
       FROM ticket WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, ticketId)
    .first<TicketRow>();
}

async function listMessages(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<MessageRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, ticket_id, workspace_id, direction, preview, sent_at, created_at
       FROM message_index WHERE workspace_id = ? AND ticket_id = ? ORDER BY sent_at ASC`,
  )
    .bind(workspaceId, ticketId)
    .all<MessageRow>();
  return rows.results ?? [];
}

async function listApprovals(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<ApprovalRow[]> {
  const rows = await env.DB.prepare(
    `SELECT kind, status, proposed_json, risk_reasons_json, created_at
       FROM approval_request WHERE workspace_id = ? AND ticket_id = ? ORDER BY created_at DESC`,
  )
    .bind(workspaceId, ticketId)
    .all<ApprovalRow>();
  return rows.results ?? [];
}

async function listOutcomes(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<OutcomeRow[]> {
  const rows = await env.DB.prepare(
    `SELECT kind, confidence_score, payload_json, created_at
       FROM ticket_outcome_event WHERE workspace_id = ? AND ticket_id = ? ORDER BY created_at DESC`,
  )
    .bind(workspaceId, ticketId)
    .all<OutcomeRow>();
  return rows.results ?? [];
}

async function listFeedback(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<FeedbackRow[]> {
  const rows = await env.DB.prepare(
    `SELECT rating, source, comment, created_at
       FROM ticket_feedback WHERE workspace_id = ? AND ticket_id = ? ORDER BY created_at DESC`,
  )
    .bind(workspaceId, ticketId)
    .all<FeedbackRow>();
  return rows.results ?? [];
}

async function getConversationScore(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<ConversationScore | null> {
  return env.DB.prepare(
    `SELECT s.*, t.subject, t.status, t.category
       FROM conversation_score s
       JOIN ticket t ON t.id = s.ticket_id AND t.workspace_id = s.workspace_id
      WHERE s.workspace_id = ? AND s.ticket_id = ?`,
  )
    .bind(workspaceId, ticketId)
    .first<ConversationScore>();
}

async function upsertKbSuggestion(
  env: Env,
  workspaceId: string,
  input: {
    clusterKey: string;
    title: string;
    summary: string;
    body: string;
    sourceTicketIds: string[];
    terms: string[];
    confidence: number;
  },
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO kb_suggestion (
       id, workspace_id, cluster_key, title, summary, body_markdown,
       source_ticket_ids_json, suggested_terms_json, evidence_count, confidence_score,
       status, source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'unresolved_cluster', ?, ?)
     ON CONFLICT(workspace_id, cluster_key) DO UPDATE SET
       title = CASE WHEN kb_suggestion.status = 'open' THEN excluded.title ELSE kb_suggestion.title END,
       summary = CASE WHEN kb_suggestion.status = 'open' THEN excluded.summary ELSE kb_suggestion.summary END,
       body_markdown = CASE WHEN kb_suggestion.status = 'open' THEN excluded.body_markdown ELSE kb_suggestion.body_markdown END,
       source_ticket_ids_json = CASE WHEN kb_suggestion.status = 'open' THEN excluded.source_ticket_ids_json ELSE kb_suggestion.source_ticket_ids_json END,
       suggested_terms_json = CASE WHEN kb_suggestion.status = 'open' THEN excluded.suggested_terms_json ELSE kb_suggestion.suggested_terms_json END,
       evidence_count = CASE WHEN kb_suggestion.status = 'open' THEN excluded.evidence_count ELSE kb_suggestion.evidence_count END,
       confidence_score = CASE WHEN kb_suggestion.status = 'open' THEN excluded.confidence_score ELSE kb_suggestion.confidence_score END,
       updated_at = CASE WHEN kb_suggestion.status = 'open' THEN excluded.updated_at ELSE kb_suggestion.updated_at END`,
  )
    .bind(
      ids.kbSuggestion(),
      workspaceId,
      input.clusterKey,
      input.title,
      input.summary,
      input.body,
      JSON.stringify(input.sourceTicketIds),
      JSON.stringify(input.terms),
      input.sourceTicketIds.length,
      input.confidence,
      now,
      now,
    )
    .run();
}

async function getKbSuggestionByCluster(
  env: Env,
  workspaceId: string,
  clusterKey: string,
): Promise<KbSuggestion | null> {
  return env.DB.prepare(`SELECT * FROM kb_suggestion WHERE workspace_id = ? AND cluster_key = ?`)
    .bind(workspaceId, clusterKey)
    .first<KbSuggestion>();
}

async function getKbSuggestion(
  env: Env,
  workspaceId: string,
  suggestionId: string,
): Promise<KbSuggestion | null> {
  return env.DB.prepare(`SELECT * FROM kb_suggestion WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, suggestionId)
    .first<KbSuggestion>();
}

async function successfulReplyCorpus(
  env: Env,
  workspaceId: string,
  ticketIds?: string[],
): Promise<Array<{ ticket_id: string; preview: string }>> {
  if (ticketIds && ticketIds.length === 0) return [];
  const ticketFilter = ticketIds?.length
    ? `AND t.id IN (${ticketIds.map(() => '?').join(',')})`
    : '';
  const rows = await env.DB.prepare(
    `SELECT DISTINCT t.id AS ticket_id, m.preview
       FROM ticket t
       JOIN message_index m ON m.ticket_id = t.id AND m.workspace_id = t.workspace_id
       LEFT JOIN ticket_feedback f ON f.ticket_id = t.id AND f.workspace_id = t.workspace_id
       LEFT JOIN ticket_outcome_event o ON o.ticket_id = t.id AND o.workspace_id = t.workspace_id
      WHERE t.workspace_id = ?
        AND m.direction = 'outbound'
        AND m.preview IS NOT NULL
        ${ticketFilter}
        AND (
          t.status IN ('resolved','closed')
          OR f.rating = 'positive'
          OR o.kind IN ('resolved_autonomously','resolved_via_procedure')
        )
      ORDER BY m.sent_at DESC LIMIT 100`,
  )
    .bind(workspaceId, ...(ticketIds ?? []))
    .all<{ ticket_id: string; preview: string }>();
  return rows.results ?? [];
}

async function sourceChunksForDrift(
  env: Env,
  workspaceId: string,
  sourceId: string,
): Promise<Array<{ id: string; body: string }>> {
  const rows = await env.DB.prepare(
    `SELECT id, body FROM knowledge_chunk WHERE workspace_id = ? AND source_id = ? ORDER BY ordinal ASC`,
  )
    .bind(workspaceId, sourceId)
    .all<{ id: string; body: string }>();
  return rows.results ?? [];
}

async function citedTicketIdsForSource(
  env: Env,
  workspaceId: string,
  chunkIds: string[],
): Promise<string[]> {
  const lineageIds = chunkIds.slice(0, MAX_SOURCE_CHUNKS_FOR_LINEAGE);
  if (lineageIds.length === 0) return [];
  const conditions = lineageIds.map(() => `proposed_json LIKE ? ESCAPE '\\'`).join(' OR ');
  const rows = await env.DB.prepare(
    `SELECT DISTINCT ticket_id
       FROM approval_request
      WHERE workspace_id = ?
        AND (${conditions})
      ORDER BY created_at DESC
      LIMIT 100`,
  )
    .bind(workspaceId, ...lineageIds.map((id) => `%${escapeLike(JSON.stringify(id))}%`))
    .all<{ ticket_id: string }>();
  return (rows.results ?? []).map((row) => row.ticket_id);
}

async function upsertDriftSignal(
  env: Env,
  workspaceId: string,
  input: {
    sourceId: string;
    signalHash: string;
    severity: 'low' | 'medium' | 'high';
    title: string;
    summary: string;
    successfulReplyCount: number;
    divergenceTerms: string[];
    exampleTicketIds: string[];
  },
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO knowledge_drift_signal (
       id, workspace_id, source_id, signal_hash, severity, title, summary,
       successful_reply_count, divergence_terms_json, example_ticket_ids_json,
       status, detected_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
     ON CONFLICT(workspace_id, source_id, signal_hash) DO UPDATE SET
       severity = excluded.severity,
       title = excluded.title,
       summary = excluded.summary,
       successful_reply_count = excluded.successful_reply_count,
       divergence_terms_json = excluded.divergence_terms_json,
       example_ticket_ids_json = excluded.example_ticket_ids_json,
       updated_at = CASE WHEN knowledge_drift_signal.status = 'open' THEN excluded.updated_at ELSE knowledge_drift_signal.updated_at END`,
  )
    .bind(
      ids.knowledgeDriftSignal(),
      workspaceId,
      input.sourceId,
      input.signalHash,
      input.severity,
      input.title,
      input.summary,
      input.successfulReplyCount,
      JSON.stringify(input.divergenceTerms),
      JSON.stringify(input.exampleTicketIds),
      now,
      now,
    )
    .run();
}

async function getDriftSignalByHash(
  env: Env,
  workspaceId: string,
  sourceId: string,
  signalHash: string,
): Promise<KnowledgeDriftSignal | null> {
  return env.DB.prepare(
    `SELECT * FROM knowledge_drift_signal WHERE workspace_id = ? AND source_id = ? AND signal_hash = ?`,
  )
    .bind(workspaceId, sourceId, signalHash)
    .first<KnowledgeDriftSignal>();
}

async function getDriftSignal(
  env: Env,
  workspaceId: string,
  signalId: string,
): Promise<KnowledgeDriftSignal | null> {
  return env.DB.prepare(`SELECT * FROM knowledge_drift_signal WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, signalId)
    .first<KnowledgeDriftSignal>();
}

function scoreGroundedness(input: {
  hasOutbound: boolean;
  citedCount: number;
  proposedConfidence: number;
  groundedTrace: boolean;
  hasKnowledgeHits: boolean;
  risks: string[];
}): number {
  if (!input.hasOutbound) return 0.2;
  let score = input.citedCount > 0 ? 0.78 : input.hasKnowledgeHits ? 0.62 : 0.52;
  if (input.groundedTrace) score += 0.08;
  if (input.proposedConfidence > 0) score += Math.min(0.1, input.proposedConfidence * 0.1);
  if (input.risks.some((risk) => /insufficient|uncited|weak_retrieval|stale/i.test(risk))) {
    score -= 0.25;
  }
  return clamp01(score);
}

function scoreTone(text: string): number {
  if (!text.trim()) return 0.5;
  const lower = text.toLowerCase();
  let score = 0.82;
  if (/\b(thank|thanks|please|happy to help|i can help)\b/.test(lower)) score += 0.08;
  if (/\b(stupid|obvious|not our problem|as stated|you failed|you must)\b/.test(lower))
    score -= 0.28;
  if (/[A-Z]{12,}/.test(text)) score -= 0.12;
  if (lower.length < 40) score -= 0.08;
  return clamp01(score);
}

function scoreResolution(
  status: string,
  signals: {
    resolvedByOutcome: boolean;
    escalated: boolean;
    followedUp: boolean;
    hasPositiveFeedback: boolean;
    hasNegativeFeedback: boolean;
  },
): number {
  let score =
    status === 'resolved' || status === 'closed' ? 0.82 : status === 'pending' ? 0.5 : 0.28;
  if (signals.resolvedByOutcome) score += 0.1;
  if (signals.escalated) score -= 0.15;
  if (signals.followedUp) score -= 0.22;
  if (signals.hasPositiveFeedback) score += 0.1;
  if (signals.hasNegativeFeedback) score -= 0.25;
  return clamp01(score);
}

function scoreEffort(input: {
  inboundCount: number;
  outboundCount: number;
  escalated: boolean;
  followedUp: boolean;
  pendingApprovals: number;
}): number {
  let score = 0.94;
  score -= Math.max(0, input.inboundCount - 1) * 0.08;
  score -= Math.max(0, input.outboundCount - 2) * 0.05;
  if (input.escalated) score -= 0.12;
  if (input.followedUp) score -= 0.18;
  if (input.pendingApprovals > 0) score -= 0.08;
  return clamp01(score);
}

function weightedScore(scores: {
  groundedness: number;
  tone: number;
  resolution: number;
  effort: number;
}): number {
  return round4(
    scores.groundedness * 0.3 + scores.tone * 0.2 + scores.resolution * 0.35 + scores.effort * 0.15,
  );
}

function averageScore<T extends Record<string, number>>(rows: T[], key: keyof T): number | null {
  if (rows.length === 0) return null;
  return round4(rows.reduce((sum, row) => sum + row[key], 0) / rows.length);
}

function topUnresolvedIntents(
  tickets: Array<{ id: string; subject: string; category: string | null }>,
): InsightSummary['top_unresolved_intents'] {
  const groups = new Map<string, { count: number; example: string }>();
  for (const ticket of tickets) {
    const intent = inferTicketIntent(ticket.category, ticket.subject);
    const current = groups.get(intent) ?? { count: 0, example: ticket.id };
    current.count += 1;
    groups.set(intent, current);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([intent, value]) => ({
      intent,
      count: value.count,
      example_ticket_id: value.example,
    }));
}

function slowestProcedures(
  rows: Array<{
    procedure_id: string;
    slug: string;
    name: string;
    status: string;
    duration_ms: number;
  }>,
): InsightSummary['slowest_procedures'] {
  const groups = new Map<
    string,
    {
      procedure_id: string;
      slug: string;
      name: string;
      durations: number[];
      waiting: number;
      failed: number;
    }
  >();
  for (const row of rows) {
    const current = groups.get(row.procedure_id) ?? {
      procedure_id: row.procedure_id,
      slug: row.slug,
      name: row.name,
      durations: [],
      waiting: 0,
      failed: 0,
    };
    current.durations.push(Math.max(0, row.duration_ms ?? 0));
    if (row.status === 'waiting') current.waiting += 1;
    if (row.status === 'failed') current.failed += 1;
    groups.set(row.procedure_id, current);
  }
  return [...groups.values()]
    .map((group) => ({
      procedure_id: group.procedure_id,
      slug: group.slug,
      name: group.name,
      run_count: group.durations.length,
      avg_duration_ms: Math.round(
        group.durations.reduce((sum, value) => sum + value, 0) / group.durations.length,
      ),
      waiting_count: group.waiting,
      failed_count: group.failed,
    }))
    .sort((a, b) => b.avg_duration_ms - a.avg_duration_ms)
    .slice(0, 8);
}

function escalationReason(payload: Record<string, unknown>): string {
  const reason = String(
    payload.reason ?? payload.routeTo ?? payload.route_to ?? payload.severity ?? '',
  ).trim();
  return reason.slice(0, 120) || 'Escalated';
}

function inferTicketIntent(category: string | null, subject: string): string {
  const subjectTerms = topTerms(subject, 2);
  const normalizedCategory = category?.trim().toLowerCase();
  if (normalizedCategory && subjectTerms.length > 0) {
    return `${normalizedCategory} ${subjectTerms.join(' ')}`;
  }
  return subjectTerms.length ? subjectTerms.join(' ') : normalizedCategory || 'uncategorized';
}

function humanizeIntent(intent: string): string {
  return (
    intent
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || 'Support Topic'
  );
}

function topTerms(text: string, limit: number): string[] {
  return [...termCounts(text).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []) {
    const normalized = term.replace(/^['-]+|['-]+$/g, '');
    if (normalized.length < 3 || STOP_WORDS.has(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function topCounts(values: string[], limit: number): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function suggestionConfidence(ticketCount: number, termCount: number): number {
  return clamp01(Math.min(0.95, 0.48 + ticketCount * 0.1 + Math.min(termCount, 8) * 0.025));
}

function sourceIdForSuggestion(suggestionId: string): string {
  const suffix = suggestionId.startsWith('kb_sug_')
    ? suggestionId.slice('kb_sug_'.length)
    : suggestionId;
  return `ksrc_sug_${suffix}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasFinalAnswerableTrace(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'finalAnswerable' in value &&
    value.finalAnswerable === true
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  return round4(Math.min(1, Math.max(0, value)));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
