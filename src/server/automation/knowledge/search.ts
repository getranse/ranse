import type { KnowledgeSearchOptions } from '../../../interfaces/knowledge';
export type { KnowledgeSearchOptions };
import type { Env } from '../../env';
import type { KnowledgeHit, KnowledgeSourceKind } from '../../../types/shared/knowledge';
import { RERANKER_MODEL } from './constants';
import { normalizeWhitespace } from './text';
import { embedTexts, vectorIndex } from './vector';

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 12);
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let idx = text.indexOf(token);
  while (idx >= 0) {
    count++;
    idx = text.indexOf(token, idx + token.length);
  }
  return count;
}

function makeSnippet(body: string, tokens: string[]): string {
  const lower = body.toLowerCase();
  const idx =
    tokens
      .map((t) => lower.indexOf(t))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  return normalizeWhitespace(body.slice(Math.max(0, idx - 90), idx + 420));
}

function sourceKindClause(kinds?: KnowledgeSourceKind[]) {
  if (!kinds?.length) return { sql: '', binds: [] as string[] };
  return { sql: ` AND s.kind IN (${kinds.map(() => '?').join(',')})`, binds: kinds };
}

async function keywordSearchKnowledge(
  env: Env,
  workspaceId: string,
  query: string,
  limit: number,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeHit[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const kindFilter = sourceKindClause(options.sourceKinds);

  const rows = await env.DB.prepare(
    `SELECT c.id, c.source_id, c.title, c.url, c.body, c.used_in_answers_count, c.updated_at,
            s.kind AS source_kind, s.r2_key, s.staleness_score
       FROM knowledge_chunk c
       JOIN knowledge_source s ON s.id = c.source_id
      WHERE c.workspace_id = ? AND s.status = 'ready'${kindFilter.sql}
      ORDER BY c.updated_at DESC
      LIMIT 2000`,
  )
    .bind(workspaceId, ...kindFilter.binds)
    .all<{
      id: string;
      source_id: string;
      title: string;
      url: string | null;
      body: string;
      used_in_answers_count: number;
      updated_at: number;
      source_kind: KnowledgeSourceKind;
      r2_key: string | null;
      staleness_score: number | null;
    }>();

  return (rows.results ?? [])
    .map((row) => {
      const title = row.title.toLowerCase();
      const body = row.body.toLowerCase();
      const score = tokens.reduce(
        (sum, token) => sum + countOccurrences(title, token) * 3 + countOccurrences(body, token),
        0,
      );
      return {
        id: row.id,
        sourceId: row.source_id,
        sourceKind: row.source_kind,
        title: row.title,
        url: row.r2_key ? `/api/knowledge/${row.source_id}/file` : (row.url ?? undefined),
        snippet: makeSnippet(row.body, tokens),
        score,
        usedInAnswersCount: row.used_in_answers_count,
        updatedAt: row.updated_at,
        stalenessScore: row.staleness_score ?? 0,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function hydrateVectorMatches(
  env: Env,
  workspaceId: string,
  matches: Array<{ id: string; score: number }>,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeHit[]> {
  if (matches.length === 0) return [];
  const scoreByVectorId = new Map(matches.map((m) => [m.id, m.score]));
  const placeholders = matches.map(() => '?').join(',');
  const kindFilter = sourceKindClause(options.sourceKinds);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.source_id, c.title, c.url, c.snippet, c.vector_id, c.used_in_answers_count,
            c.updated_at,
            s.kind AS source_kind, s.r2_key, s.staleness_score
       FROM knowledge_chunk c
       JOIN knowledge_source s ON s.id = c.source_id
      WHERE c.workspace_id = ? AND s.status = 'ready'${kindFilter.sql} AND c.vector_id IN (${placeholders})`,
  )
    .bind(workspaceId, ...kindFilter.binds, ...matches.map((m) => m.id))
    .all<{
      id: string;
      source_id: string;
      title: string;
      url: string | null;
      snippet: string;
      vector_id: string;
      used_in_answers_count: number;
      updated_at: number;
      source_kind: KnowledgeSourceKind;
      r2_key: string | null;
      staleness_score: number | null;
    }>();

  const rowByVectorId = new Map((rows.results ?? []).map((row) => [row.vector_id, row]));
  return matches
    .map((match) => {
      const row = rowByVectorId.get(match.id);
      if (!row) return null;
      return {
        id: row.id,
        sourceId: row.source_id,
        sourceKind: row.source_kind,
        title: row.title,
        url: row.r2_key ? `/api/knowledge/${row.source_id}/file` : (row.url ?? undefined),
        snippet: row.snippet,
        score: scoreByVectorId.get(match.id) ?? 0,
        usedInAnswersCount: row.used_in_answers_count,
        updatedAt: row.updated_at,
        stalenessScore: row.staleness_score ?? 0,
      };
    })
    .filter(Boolean) as KnowledgeHit[];
}

function mergeKnowledgeHits(groups: KnowledgeHit[][]): KnowledgeHit[] {
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
  return Array.from(byId.values());
}

function normalizeWorkersAiModel(modelName?: string | null, fallback = RERANKER_MODEL): string {
  const trimmed = modelName?.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('workers-ai/')) return trimmed.slice('workers-ai/'.length);
  if (trimmed.startsWith('@cf/')) return trimmed;
  return fallback;
}

async function resolveRerankerModel(env: Env, workspaceId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT model_name FROM workspace_llm_config WHERE workspace_id = ? AND action_key = 'knowledge_query'`,
  )
    .bind(workspaceId)
    .first<{ model_name: string }>();
  return normalizeWorkersAiModel(row?.model_name, RERANKER_MODEL);
}

async function rerankKnowledge(
  env: Env,
  workspaceId: string,
  query: string,
  hits: KnowledgeHit[],
  limit: number,
): Promise<KnowledgeHit[]> {
  if (hits.length <= 1) return applyStalenessDiscount(hits).slice(0, limit);
  try {
    const model = await resolveRerankerModel(env, workspaceId);
    const result = await (env.AI as any).run(model, {
      query,
      contexts: hits.map((h) => ({ text: `${h.title}\n${h.snippet}` })),
      top_k: Math.min(limit, hits.length),
    });
    const ranked = result?.response ?? result?.result ?? result?.data;
    if (!Array.isArray(ranked) || ranked.length === 0) {
      return applyStalenessDiscount(hits).slice(0, limit);
    }
    const reranked = ranked
      .map((r: any) => {
        const id = Number(r.id);
        if (!Number.isInteger(id) || !hits[id]) return null;
        return { ...hits[id], score: typeof r.score === 'number' ? r.score : hits[id].score };
      })
      .filter(Boolean) as KnowledgeHit[];
    const discounted = applyStalenessDiscount(reranked.length ? reranked : hits);
    discounted.sort((a, b) => b.score - a.score);
    return discounted.slice(0, limit);
  } catch {
    return applyStalenessDiscount(hits).slice(0, limit);
  }
}

function applyStalenessDiscount(hits: KnowledgeHit[]): KnowledgeHit[] {
  // Down-rank stale chunks but never zero them out — operators still want to
  // see the candidate in Answer Inspection so they can decide whether to
  // refresh the source. A staleness of 1.0 halves the retrieval score.
  return hits.map((hit) => {
    const s = Math.max(0, Math.min(1, hit.stalenessScore ?? 0));
    return s === 0 ? hit : { ...hit, score: hit.score * (1 - 0.5 * s) };
  });
}

export async function searchKnowledge(
  env: Env,
  workspaceId: string,
  query: string,
  limit = 5,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let vectorHits: KnowledgeHit[] = [];
  const index = vectorIndex(env);
  if (index) {
    try {
      const [embedding] = await embedTexts(env, [trimmed.slice(0, 8000)]);
      const result = await index.query(embedding, {
        topK: Math.max(limit * 4, 12),
        namespace: workspaceId,
        returnMetadata: 'indexed',
        returnValues: false,
      });
      const matches = (result.matches ?? [])
        .filter((m) => m.id && typeof m.score === 'number')
        .map((m) => ({ id: m.id, score: m.score }));
      vectorHits = await hydrateVectorMatches(env, workspaceId, matches, options);
    } catch (error) {
      console.warn('knowledge vector search failed; falling back to keyword search', error);
    }
  }

  const keywordHits = await keywordSearchKnowledge(
    env,
    workspaceId,
    trimmed,
    Math.max(limit * 2, 10),
    options,
  );
  const candidates = mergeKnowledgeHits([vectorHits, keywordHits]);
  return candidates.length === 0
    ? []
    : rerankKnowledge(env, workspaceId, trimmed, candidates, limit);
}

export async function recordKnowledgeUsage(
  env: Env,
  workspaceId: string,
  chunkIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(chunkIds.filter(Boolean)));
  if (unique.length === 0) return;
  const placeholders = unique.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE knowledge_chunk
        SET used_in_answers_count = used_in_answers_count + 1
      WHERE workspace_id = ? AND id IN (${placeholders})`,
  )
    .bind(workspaceId, ...unique)
    .run();
}
