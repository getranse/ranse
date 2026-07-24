import type { KnowledgeSourceKind } from '../../types/shared/knowledge';
import type { KnowledgeIngestInput } from '../automation/knowledge/sources';
import type { Env } from '../env';

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

export async function mirrorLegacyDoc(
  env: Env,
  workspaceId: string,
  sourceId: string,
  kind: KnowledgeSourceKind,
  title: string,
  body: string,
  url: string | undefined,
  now: number,
) {
  if (kind !== 'manual' && kind !== 'url') return;
  await env.DB.prepare(
    `INSERT INTO knowledge_doc (id, workspace_id, title, body, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, url = excluded.url, updated_at = excluded.updated_at`,
  )
    .bind(sourceId, workspaceId, title, body, url ?? null, now, now)
    .run();
}
