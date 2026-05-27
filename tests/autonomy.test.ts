import { describe, expect, it } from 'vitest';
import { autonomyRollout, decideAutonomy, scoreAutonomousDraft } from '../src/server/agents/supervisor/autonomy';
import {
  normalizeAutonomyPolicy,
  normalizeAutonomyRolloutPercent,
  normalizeAutonomyThreshold,
  type AutonomousDraftScore,
} from '../src/types/autonomy';
import type { DraftResult } from '../src/server/agents/specialists/draft';
import type { TriageResult } from '../src/server/agents/specialists/triage';
import type { AgenticKnowledgeResult } from '../src/types/knowledge';

const triage: TriageResult = {
  category: 'billing',
  priority: 'normal',
  sentiment: 'neutral',
  language: 'en',
  summary: 'Refund question',
  tags: [],
  suggested_auto_reply_allowed: true,
};

const draft: DraftResult = {
  subject: 'Re: Refund',
  body_markdown: 'You are eligible for a refund within 30 days.',
  tone: 'friendly',
  cites_knowledge_ids: ['chunk_1'],
  confidence: 0.96,
  needs_human_review_reasons: [],
};

const retrieval: AgenticKnowledgeResult = {
  hits: [
    {
      id: 'chunk_1',
      sourceId: 'source_1',
      sourceKind: 'manual',
      title: 'Refund policy',
      snippet: 'Refunds are available within 30 days.',
      score: 0.92,
      usedInAnswersCount: 0,
      updatedAt: 1_000,
    },
  ],
  trace: {
    plan: { originalQuery: 'refund', scope: 'knowledge', subqueries: ['refund'], maxHops: 1 },
    hops: [],
    finalAnswerable: true,
    stopReason: 'sufficient',
  },
};

describe('mailbox autonomy policy', () => {
  it('normalizes legacy policy names and thresholds', () => {
    expect(normalizeAutonomyPolicy('off')).toBe('draft_only');
    expect(normalizeAutonomyPolicy('safe')).toBe('auto_send_if_confident');
    expect(normalizeAutonomyPolicy('always')).toBe('auto_send_always');
    expect(normalizeAutonomyThreshold(0.1)).toBe(0.5);
    expect(normalizeAutonomyThreshold(2)).toBe(0.99);
    expect(normalizeAutonomyRolloutPercent(-5)).toBe(0);
    expect(normalizeAutonomyRolloutPercent(150)).toBe(100);
  });

  it('auto-sends only when the score clears policy and evidence gates', () => {
    const score = scoreAutonomousDraft({ draft, triage, retrieval, now: 1_000 });

    expect(score.score).toBeGreaterThan(0.85);
    expect(score.riskReasons).toEqual([]);
    expect(decideAutonomy({
      policy: 'auto_send_if_confident',
      threshold: 0.85,
      score,
    })).toEqual({ action: 'auto_send', reason: 'confidence_threshold_met' });
  });

  it('fails closed when evidence is insufficient', () => {
    const score = scoreAutonomousDraft({
      draft: { ...draft, cites_knowledge_ids: [] },
      triage,
      retrieval: { ...retrieval, hits: [], trace: { ...retrieval.trace, finalAnswerable: false } },
      now: 1_000,
    });

    expect(score.hardBlockReasons).toContain('insufficient_evidence');
    expect(decideAutonomy({
      policy: 'auto_send_always',
      threshold: 0.5,
      score: score as AutonomousDraftScore,
    }).action).toBe('create_approval');
  });

  it('lets auto-send-always bypass score risks but not hard blockers', () => {
    const score = scoreAutonomousDraft({
      draft: { ...draft, confidence: 0.55 },
      triage,
      retrieval: {
        ...retrieval,
        hits: [{ ...retrieval.hits[0], score: 0.2, updatedAt: 1 }],
      },
      now: 20_000_000_000,
    });

    expect(score.riskReasons).toContain('low_llm_confidence');
    expect(decideAutonomy({
      policy: 'auto_send_always',
      threshold: 0.99,
      score,
    })).toEqual({ action: 'auto_send', reason: 'auto_send_always' });
  });

  it('gates autonomous send by deterministic rollout percentage', () => {
    const rollout = autonomyRollout({ mailboxId: 'mb_1', ticketId: 'tkt_1', percent: 0 });
    const score = scoreAutonomousDraft({ draft, triage, retrieval, now: 1_000 });

    expect(rollout.allowed).toBe(false);
    expect(decideAutonomy({
      policy: 'auto_send_if_confident',
      threshold: 0.5,
      rolloutAllowed: rollout.allowed,
      score,
    })).toEqual({ action: 'create_approval', reason: 'outside_autonomy_rollout' });
  });
});
