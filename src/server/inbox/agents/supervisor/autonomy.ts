import type { MailboxAutonomy } from '../../../../interfaces/agents';
export type { MailboxAutonomy };
import type { Env } from '../../../env';
import type { DraftResult } from '../specialists/draft';
import type { TriageResult } from '../specialists/triage';
import type { AgenticKnowledgeResult, KnowledgeHit } from '../../../../types/shared/knowledge';
import {
  type AutonomyDecision,
  type AutonomyPolicy,
  type AutonomousDraftScore,
  normalizeAutonomyPolicy,
  normalizeAutonomyRolloutPercent,
  normalizeAutonomyThreshold,
} from '../../../../types/shared/autonomy';

export async function loadMailboxAutonomy(
  env: Env,
  workspaceId: string,
  mailboxId: string,
): Promise<MailboxAutonomy> {
  const row = await env.DB.prepare(
    `SELECT autonomy_policy, autonomy_threshold, autonomy_rollout_percent, auto_reply_policy
       FROM mailbox
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(mailboxId, workspaceId)
    .first<{
      autonomy_policy?: string | null;
      autonomy_threshold?: number | null;
      autonomy_rollout_percent?: number | null;
      auto_reply_policy?: string | null;
    }>();
  return {
    policy: normalizeAutonomyPolicy(row?.autonomy_policy ?? row?.auto_reply_policy),
    threshold: normalizeAutonomyThreshold(row?.autonomy_threshold),
    rolloutPercent: normalizeAutonomyRolloutPercent(row?.autonomy_rollout_percent),
  };
}

export function scoreAutonomousDraft(input: {
  draft: DraftResult;
  triage: TriageResult;
  retrieval: AgenticKnowledgeResult;
  now?: number;
}): AutonomousDraftScore {
  const now = input.now ?? Date.now();
  const cited = citedHits(input.draft, input.retrieval.hits);
  const components = {
    draftConfidence: clamp01(input.draft.confidence),
    retrievalScore: normalizedRetrievalScore(input.retrieval.hits),
    groundedness: groundedness(input.retrieval, cited.length),
    freshness: freshnessScore(input.retrieval.hits, now),
  };
  const score = roundScore(
    components.draftConfidence * 0.45 +
      components.retrievalScore * 0.25 +
      components.groundedness * 0.2 +
      components.freshness * 0.1,
  );
  const riskReasons = autonomyRiskReasons(input.draft, input.triage, input.retrieval, cited.length, now);
  const hardBlockReasons = hardBlocks(input.draft, input.triage, input.retrieval, cited.length);
  return { score, components, riskReasons, hardBlockReasons };
}

export function decideAutonomy(input: {
  policy: AutonomyPolicy;
  threshold: number;
  rolloutAllowed?: boolean;
  score: AutonomousDraftScore;
}): AutonomyDecision {
  if (input.score.hardBlockReasons.length > 0) {
    return { action: 'create_approval', reason: input.score.hardBlockReasons[0] };
  }
  if (input.policy === 'draft_only') return { action: 'create_approval', reason: 'draft_only' };
  if (input.rolloutAllowed === false) {
    return { action: 'create_approval', reason: 'outside_autonomy_rollout' };
  }
  if (input.policy === 'auto_send_always') {
    return { action: 'auto_send', reason: 'auto_send_always' };
  }
  if (input.score.riskReasons.length > 0) {
    return { action: 'create_approval', reason: input.score.riskReasons[0] };
  }
  return input.score.score >= input.threshold
    ? { action: 'auto_send', reason: 'confidence_threshold_met' }
    : { action: 'create_approval', reason: 'below_confidence_threshold' };
}

export function autonomyRollout(input: {
  mailboxId: string;
  ticketId: string;
  percent: number;
}): { allowed: boolean; bucket: number; percent: number } {
  const percent = normalizeAutonomyRolloutPercent(input.percent);
  const bucket = stableBucket(`${input.mailboxId}:${input.ticketId}`);
  return { allowed: bucket < percent, bucket, percent };
}

function citedHits(draft: DraftResult, hits: KnowledgeHit[]) {
  const citedIds = new Set(draft.cites_knowledge_ids);
  return hits.filter((hit) => citedIds.has(hit.id));
}

function hardBlocks(
  draft: DraftResult,
  triage: TriageResult,
  retrieval: AgenticKnowledgeResult,
  citedCount: number,
): string[] {
  const reasons: string[] = [];
  if (!draft.body_markdown.trim()) reasons.push('empty_draft');
  if (triage.category === 'spam') reasons.push('spam');
  if (triage.sentiment === 'hostile') reasons.push('hostile_sentiment');
  if (triage.priority === 'urgent') reasons.push('urgent_priority');
  if (draft.needs_human_review_reasons.length) reasons.push(...draft.needs_human_review_reasons);
  if (!retrieval.trace.finalAnswerable) reasons.push('insufficient_evidence');
  if (retrieval.hits.length > 0 && citedCount === 0) reasons.push('uncited_evidence');
  return unique(reasons);
}

function autonomyRiskReasons(
  draft: DraftResult,
  triage: TriageResult,
  retrieval: AgenticKnowledgeResult,
  citedCount: number,
  now: number,
): string[] {
  const reasons = [...hardBlocks(draft, triage, retrieval, citedCount)];
  if (draft.confidence < 0.8) reasons.push('low_llm_confidence');
  if (normalizedRetrievalScore(retrieval.hits) < 0.45) reasons.push('weak_retrieval_score');
  if (freshnessScore(retrieval.hits, now) < 0.35) reasons.push('stale_evidence');
  return unique(reasons);
}

function groundedness(retrieval: AgenticKnowledgeResult, citedCount: number): number {
  if (!retrieval.trace.finalAnswerable || retrieval.hits.length === 0) return 0;
  const citationRatio = citedCount / Math.max(retrieval.hits.length, 1);
  return clamp01(0.55 + Math.min(citationRatio, 1) * 0.45);
}

function normalizedRetrievalScore(hits: KnowledgeHit[]): number {
  if (hits.length === 0) return 0;
  const top = hits.slice(0, 3).map((hit) => normalizeHitScore(hit.score));
  return top.reduce((sum, score) => sum + score, 0) / top.length;
}

function freshnessScore(hits: KnowledgeHit[], now: number): number {
  if (hits.length === 0) return 0;
  const scores = hits.slice(0, 5).map((hit) => {
    if (!hit.updatedAt) return 0.5;
    const ageDays = Math.max(0, (now - hit.updatedAt) / 86_400_000);
    if (ageDays <= 30) return 1;
    if (ageDays >= 180) return 0.2;
    return 1 - ((ageDays - 30) / 150) * 0.8;
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function normalizeHitScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (score <= 1) return score;
  return Math.min(1, Math.log10(score + 1) / 2);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function stableBucket(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}
