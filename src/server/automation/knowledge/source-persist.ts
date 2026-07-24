import type { Env } from '../../env';
import type { buildChunkRows } from './source-ingest';
import type { KnowledgeIngestInput } from './sources';

export async function insertSourceShell(
  env: Env,
  workspaceId: string,
  sourceId: string,
  input: KnowledgeIngestInput,
  title: string,
  sourceHash: string,
  lastCrawledAt: number | null,
  now: number,
) {
  await env.DB.prepare(
    `INSERT INTO knowledge_source (
       id, workspace_id, kind, title, url, r2_key, ticket_id, message_id, content_hash,
       status, chunk_count, last_crawled_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'indexing', 0, ?, ?, ?)`,
  )
    .bind(
      sourceId,
      workspaceId,
      input.kind,
      title,
      input.url ?? null,
      input.r2Key ?? null,
      input.ticketId ?? null,
      input.messageId ?? null,
      sourceHash,
      lastCrawledAt,
      now,
      now,
    )
    .run();
}

export async function replaceSourceChunks(
  env: Env,
  workspaceId: string,
  sourceId: string,
  input: KnowledgeIngestInput,
  title: string,
  sourceHash: string,
  lastCrawledAt: number | null,
  now: number,
  chunks: Awaited<ReturnType<typeof buildChunkRows>>,
  vectorized: boolean,
) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM knowledge_chunk WHERE source_id = ? AND workspace_id = ?`).bind(
      sourceId,
      workspaceId,
    ),
    ...chunks.map((c) =>
      env.DB.prepare(
        `INSERT INTO knowledge_chunk (
         id, workspace_id, source_id, ordinal, title, body, snippet, url, vector_id, content_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        c.id,
        workspaceId,
        sourceId,
        c.ordinal,
        title,
        c.body,
        c.snippet,
        input.url ?? null,
        c.vectorId,
        c.hash,
        now,
        now,
      ),
    ),
    env.DB.prepare(
      `UPDATE knowledge_source
          SET kind = ?, title = ?, url = ?, r2_key = ?, ticket_id = ?, message_id = ?,
              content_hash = ?, status = 'ready', chunk_count = ?,
              last_crawled_at = COALESCE(?, last_crawled_at),
              last_indexed_at = ?, error = NULL, updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    ).bind(
      input.kind,
      title,
      input.url ?? null,
      input.r2Key ?? null,
      input.ticketId ?? null,
      input.messageId ?? null,
      sourceHash,
      chunks.length,
      lastCrawledAt,
      vectorized ? now : null,
      now,
      sourceId,
      workspaceId,
    ),
  ]);
}
