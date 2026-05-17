import type { Env } from '../env';
import type { AgentConfig } from '../llm/config.types';
import type {
  AgenticKnowledgeResult,
  AgenticRetrievalHop,
  AgenticRetrievalJudgment,
  AgenticRetrievalPlan,
  AgenticRetrievalTrace,
  KnowledgeHit,
  KnowledgeSearchScope,
} from '../types/knowledge';
import {
  type AgenticSearchOptions,
  judgeSearch,
  normalizePlan,
  planSearch,
  rewriteQuery,
  sourceKindsForScope,
} from './agentic-llm';
import { searchKnowledge } from './search';

export type { AgenticSearchOptions } from './agentic-llm';

function mergeHits(groups: KnowledgeHit[][], limit: number): KnowledgeHit[] {
  const byId = new Map<string, KnowledgeHit>();
  for (const hits of groups) {
    for (const hit of hits) {
      const existing = byId.get(hit.id);
      if (!existing || hit.score > existing.score) {
        byId.set(hit.id, {
          ...existing,
          ...hit,
          score: Math.max(hit.score, existing?.score ?? hit.score),
        });
      }
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function finish(
  plan: AgenticRetrievalPlan,
  hops: AgenticRetrievalHop[],
  hits: KnowledgeHit[],
  startedAt: number,
  finalAnswerable: boolean,
  stopReason: AgenticRetrievalTrace['stopReason'],
): AgenticKnowledgeResult {
  return {
    hits,
    trace: {
      plan,
      hops,
      finalAnswerable,
      stopReason,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
    },
  };
}

function emptyResult(query: string, options: AgenticSearchOptions): AgenticKnowledgeResult {
  const startedAt = Date.now();
  const plan = normalizePlan(
    query,
    { scope: options.scope ?? 'all', subqueries: [], max_hops: options.maxHops ?? 3 },
    options,
    'system',
  );
  return finish(plan, [], [], startedAt, false, 'no_hits');
}

function noEvidenceStopReason(
  hitGroups: KnowledgeHit[][],
  fallback: AgenticRetrievalTrace['stopReason'],
): AgenticRetrievalTrace['stopReason'] {
  return hitGroups.some((hits) => hits.length > 0) ? fallback : 'no_hits';
}

function customerDataJudgment(): AgenticRetrievalJudgment {
  return {
    sufficient: false,
    reasoning: 'Customer-data search is not connected yet.',
    missing: ['customer data connector'],
    source: 'system',
  };
}

function enforceEvidence(judgment: AgenticRetrievalJudgment, hitCount: number) {
  if (!judgment.sufficient || hitCount > 0) return judgment;
  return {
    ...judgment,
    sufficient: false,
    reasoning: `${judgment.reasoning || 'Marked sufficient without evidence.'} No supporting evidence was retrieved.`,
    missing: Array.from(new Set([...judgment.missing, 'supporting evidence'])),
  };
}

export async function agenticSearchKnowledge(
  env: Env,
  workspaceId: string,
  query: string,
  options: AgenticSearchOptions = {},
): Promise<AgenticKnowledgeResult> {
  const trimmed = query.trim();
  if (!trimmed) return emptyResult(trimmed, options);

  const startedAt = Date.now();
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const plan = await planSearch(env, workspaceId, trimmed, options);
  const queued = [...plan.subqueries];
  const seenQueries = new Set<string>();
  const hitGroups: KnowledgeHit[][] = [];
  const hops: AgenticRetrievalHop[] = [];

  for (let hop = 1; hop <= plan.maxHops; hop++) {
    const current = (queued.shift() ?? trimmed).trim();
    if (!current || seenQueries.has(current.toLowerCase())) {
      return finish(
        plan,
        hops,
        mergeHits(hitGroups, limit),
        startedAt,
        false,
        noEvidenceStopReason(hitGroups, 'no_next_query'),
      );
    }

    seenQueries.add(current.toLowerCase());
    const sourceKinds = sourceKindsForScope(plan.scope);
    const searchStartedAt = Date.now();
    const hits =
      sourceKinds?.length === 0
        ? []
        : await searchKnowledge(env, workspaceId, current, Math.max(limit * 2, 8), { sourceKinds });
    const searchMs = Math.max(0, Date.now() - searchStartedAt);
    hitGroups.push(hits);

    const accumulated = mergeHits(hitGroups, Math.max(limit * 2, 8));
    const judgeStartedAt = Date.now();
    const rawJudgment =
      sourceKinds?.length === 0
        ? customerDataJudgment()
        : await judgeSearch(env, workspaceId, trimmed, current, accumulated, hop, options);
    const judgment = enforceEvidence(rawJudgment, accumulated.length);
    const judgeMs = Math.max(0, Date.now() - judgeStartedAt);
    hops.push({
      hop,
      query: current,
      scope: plan.scope,
      hits,
      judgment,
      accumulatedHitCount: accumulated.length,
      searchMs,
      judgeMs,
    });

    if (judgment.sufficient) {
      return finish(plan, hops, mergeHits(hitGroups, limit), startedAt, true, 'sufficient');
    }
    if (sourceKinds?.length === 0) {
      return finish(plan, hops, [], startedAt, false, 'no_hits');
    }

    const next =
      judgment.nextQuery ??
      queued.shift() ??
      (await rewriteQuery(env, workspaceId, trimmed, judgment.missing, options));
    const normalizedNext = next?.trim();
    if (!normalizedNext || seenQueries.has(normalizedNext.toLowerCase())) {
      return finish(
        plan,
        hops,
        mergeHits(hitGroups, limit),
        startedAt,
        false,
        noEvidenceStopReason(hitGroups, 'no_next_query'),
      );
    }
    queued.unshift(normalizedNext);
  }

  return finish(plan, hops, mergeHits(hitGroups, limit), startedAt, false, 'max_hops');
}

export async function searchProcedurePrimitive(
  env: Env,
  workspaceId: string,
  args: {
    query: string;
    scope?: KnowledgeSearchScope;
    max_hops?: number;
    limit?: number;
  },
  workspaceConfig?: Partial<AgentConfig>,
): Promise<AgenticKnowledgeResult> {
  return agenticSearchKnowledge(env, workspaceId, args.query, {
    scope: args.scope,
    maxHops: args.max_hops,
    limit: args.limit,
    workspaceConfig,
  });
}
