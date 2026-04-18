import type { Env } from '../../env';

export interface KnowledgeHit {
  id: string;
  title: string;
  url?: string;
  snippet: string;
  score: number;
}

/**
 * Lightweight keyword search over knowledge_doc. v1: LIKE-based scoring.
 * Replace with Vectorize or BM25 in a later phase.
 */
export async function searchKnowledge(
  env: Env,
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<KnowledgeHit[]> {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (tokens.length === 0) return [];

  const rows = await env.DB.prepare(
    `SELECT id, title, url, body FROM knowledge_doc WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .all<{ id: string; title: string; url: string | null; body: string }>();

  const scored = (rows.results ?? [])
    .map((d) => {
      const text = `${d.title} ${d.body}`.toLowerCase();
      const score = tokens.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
      const idx = tokens.map((t) => text.indexOf(t)).filter((i) => i >= 0)[0] ?? 0;
      const snippet = d.body.slice(Math.max(0, idx - 60), idx + 200);
      return { id: d.id, title: d.title, url: d.url ?? undefined, snippet, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}
