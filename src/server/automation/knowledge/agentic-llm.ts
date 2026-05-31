import type { AgenticSearchOptions } from '../../../interfaces/knowledge';
export type { AgenticSearchOptions };
import type { z } from 'zod';
import type { Env } from '../../env';
import { infer } from '../../../lib/llm/infer';
import type {
  AgenticRetrievalJudgment,
  AgenticRetrievalPlan,
  AgenticRetrievalStepSource,
  KnowledgeHit,
  KnowledgeSearchScope,
  KnowledgeSourceKind,
} from '../../../types/shared/knowledge';
import { KNOWLEDGE_SEARCH_SCOPES } from '../../../types/shared/knowledge';
import { JudgmentSchema, PlannerSchema, RewriteSchema } from '../../schemas/agentic-llm';

type RawPlan = Partial<z.infer<typeof PlannerSchema>> & Partial<AgenticRetrievalPlan>;

function validScope(scope: unknown): scope is KnowledgeSearchScope {
  return typeof scope === 'string' && KNOWLEDGE_SEARCH_SCOPES.includes(scope as KnowledgeSearchScope);
}

export function sourceKindsForScope(
  scope: KnowledgeSearchScope,
): KnowledgeSourceKind[] | undefined {
  if (scope === 'knowledge') return ['manual', 'url', 'pdf'];
  if (scope === 'resolved_tickets') return ['resolved_ticket'];
  if (scope === 'customer_data') return [];
  return undefined;
}

function uniqueQueries(queries: string[], fallback: string): string[] {
  const seen = new Set<string>();
  const values = [...queries, fallback]
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()));
  return values.length ? values : fallback.trim() ? [fallback.trim()] : [];
}

export function normalizePlan(
  query: string,
  raw: RawPlan,
  options: AgenticSearchOptions,
  source: AgenticRetrievalStepSource = raw.source ?? 'fallback',
): AgenticRetrievalPlan {
  const maxHops = Math.min(Math.max(options.maxHops ?? raw.maxHops ?? raw.max_hops ?? 3, 1), 5);
  const requestedScope = validScope(options.scope) ? options.scope : undefined;
  const fallbackScope = requestedScope ?? 'all';
  return {
    originalQuery: query,
    scope: requestedScope ?? (validScope(raw.scope) ? raw.scope : fallbackScope),
    subqueries: uniqueQueries(raw.subqueries ?? [query], query).slice(0, maxHops),
    maxHops,
    source,
    model: raw.model,
  };
}

export async function planSearch(
  env: Env,
  workspaceId: string,
  query: string,
  options: AgenticSearchOptions,
): Promise<AgenticRetrievalPlan> {
  if (options.planner) return normalizePlan(query, await options.planner(query), options, 'injected');
  try {
    const result = await infer({
      env,
      action: 'knowledge_plan',
      metadata: { workspaceId },
      workspaceConfig: options.workspaceConfig,
      schema: PlannerSchema,
      schemaName: 'KnowledgePlan',
      maxAttempts: 1,
      system:
        'Plan support knowledge retrieval. Choose the narrowest useful scope and concise subqueries.',
      user: `Customer/support question:\n${query}\n\nScopes: knowledge, resolved_tickets, customer_data, all.`,
    });
    return normalizePlan(query, { ...result.data, model: result.model }, options, 'llm');
  } catch {
    return normalizePlan(
      query,
      { scope: options.scope ?? 'all', subqueries: [query], max_hops: options.maxHops ?? 3 },
      options,
      'fallback',
    );
  }
}

export async function judgeSearch(
  env: Env,
  workspaceId: string,
  originalQuery: string,
  query: string,
  hits: KnowledgeHit[],
  hop: number,
  options: AgenticSearchOptions,
): Promise<AgenticRetrievalJudgment> {
  if (options.judge) {
    return { ...(await options.judge({ originalQuery, query, hits, hop })), source: 'injected' };
  }
  if (hits.length === 0) {
    return {
      sufficient: false,
      reasoning: 'No usable hits found.',
      missing: ['supporting evidence'],
      source: 'system',
    };
  }
  try {
    const result = await infer({
      env,
      action: 'knowledge_judge',
      metadata: { workspaceId },
      workspaceConfig: options.workspaceConfig,
      schema: JudgmentSchema,
      schemaName: 'KnowledgeJudgment',
      maxAttempts: 1,
      system:
        'Judge whether retrieved support evidence is enough to draft a grounded answer. Ask for one next query if not.',
      user: `Original question:\n${originalQuery}\n\nCurrent query:\n${query}\n\nEvidence:\n${formatHits(hits)}`,
    });
    return normalizeJudgment(result.data, 'llm', result.model);
  } catch {
    return {
      sufficient: hits.length >= Math.min(options.limit ?? 5, 2),
      reasoning: 'Fallback judged by available hit count.',
      missing: [],
      source: 'fallback',
    };
  }
}

function normalizeJudgment(
  raw: z.infer<typeof JudgmentSchema>,
  source: AgenticRetrievalStepSource,
  model?: string,
): AgenticRetrievalJudgment {
  return {
    sufficient: raw.sufficient,
    reasoning: raw.reasoning,
    missing: raw.missing ?? [],
    nextQuery: raw.next_query?.trim() || undefined,
    source,
    model,
  };
}

export async function rewriteQuery(
  env: Env,
  workspaceId: string,
  originalQuery: string,
  missing: string[],
  options: AgenticSearchOptions,
): Promise<string | undefined> {
  try {
    const result = await infer({
      env,
      action: 'knowledge_rewrite',
      metadata: { workspaceId },
      workspaceConfig: options.workspaceConfig,
      schema: RewriteSchema,
      schemaName: 'KnowledgeRewrite',
      maxAttempts: 1,
      system:
        'Rewrite a support retrieval query to find missing evidence. Return one concise query.',
      user: `Original question:\n${originalQuery}\n\nMissing evidence:\n${missing.join(', ') || 'unknown'}`,
    });
    return result.data.query.trim() || undefined;
  } catch {
    return missing.length ? `${originalQuery} ${missing.join(' ')}`.slice(0, 500) : undefined;
  }
}

function formatHits(hits: KnowledgeHit[]): string {
  return hits
    .slice(0, 8)
    .map(
      (hit, i) =>
        `[${i + 1}] id=${hit.id} kind=${hit.sourceKind} score=${hit.score}\n${hit.title}\n${hit.snippet}`,
    )
    .join('\n\n');
}
