import type { HelpArticle, HelpArticleSummary } from '../../interfaces/help-center';
import type { Env } from '../env';

export async function workspaceIdBySlug(env: Env, slug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT id FROM workspace WHERE slug = ? AND archived_at IS NULL AND deleted_at IS NULL`,
  )
    .bind(slug)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function listPublicArticles(
  env: Env,
  workspaceId: string,
): Promise<HelpArticleSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT id, title, last_indexed_at AS updated_at FROM knowledge_source
      WHERE workspace_id = ? AND public = 1 AND status = 'ready'
      ORDER BY title`,
  )
    .bind(workspaceId)
    .all<HelpArticleSummary>();
  return rows.results ?? [];
}

/** Article body assembled from its indexed chunks, in order. Public-only. */
export async function loadPublicArticle(
  env: Env,
  workspaceId: string,
  sourceId: string,
): Promise<HelpArticle | null> {
  const source = await env.DB.prepare(
    `SELECT title FROM knowledge_source
      WHERE id = ? AND workspace_id = ? AND public = 1 AND status = 'ready'`,
  )
    .bind(sourceId, workspaceId)
    .first<{ title: string }>();
  if (!source) return null;

  const chunks = await env.DB.prepare(
    `SELECT title, body FROM knowledge_chunk
      WHERE source_id = ? AND workspace_id = ?
      ORDER BY ordinal ASC`,
  )
    .bind(sourceId, workspaceId)
    .all<{ title: string; body: string }>();
  return { title: source.title, sections: chunks.results ?? [] };
}

/** Operator toggle. Returns false when the source isn't in the workspace. */
export async function setArticlePublic(
  env: Env,
  workspaceId: string,
  sourceId: string,
  isPublic: boolean,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE knowledge_source SET public = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(isPublic ? 1 : 0, sourceId, workspaceId)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}
