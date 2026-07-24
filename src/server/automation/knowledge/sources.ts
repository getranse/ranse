import type {
  KnowledgeSourceListItem,
  ResolvedTicketImportResult,
} from '../../../interfaces/knowledge-sources';
import { sha256Hex } from '../../../lib/crypto';
import { ids } from '../../../lib/ids';
import { getText } from '../../../lib/storage';
import type { KnowledgeIngestResult, KnowledgeSourceKind } from '../../../types/shared/knowledge';
import { replaceSourceChunks } from '../../actions/knowledge-chunks';
import { insertSourceShell, mirrorLegacyDoc } from '../../actions/knowledge-sources';
import type { Env } from '../../env';
import { SOURCE_STALE_AFTER_MS } from './constants';
import { fetchUrlDocument } from './crawl';
import { buildChunkRows, upsertVectors } from './source-ingest';
import { normalizeWhitespace } from './text';
import { deleteVectors } from './vector';

async function setSourceFailed(
  env: Env,
  sourceId: string,
  workspaceId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(
    `UPDATE knowledge_source
        SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(message.slice(0, 1000), Date.now(), sourceId, workspaceId)
    .run();
}

export async function listKnowledgeSources(
  env: Env,
  workspaceId: string,
): Promise<KnowledgeSourceListItem[]> {
  const staleBefore = Date.now() - SOURCE_STALE_AFTER_MS;
  const rows = await env.DB.prepare(
    `SELECT s.id, s.kind, s.title, s.url, s.r2_key,
            CASE WHEN s.r2_key IS NOT NULL THEN '/api/knowledge/' || s.id || '/file' ELSE s.url END AS source_url,
            s.status, s.chunk_count, s.public,
            s.last_crawled_at, s.last_indexed_at, s.error, s.updated_at,
            CASE WHEN s.kind = 'url' AND (s.last_crawled_at IS NULL OR s.last_crawled_at < ?) THEN 1 ELSE 0 END AS stale,
            (
              SELECT COUNT(*) FROM knowledge_source d
               WHERE d.workspace_id = s.workspace_id
                 AND d.id != s.id
                 AND d.content_hash IS NOT NULL
                 AND d.content_hash = s.content_hash
            ) AS duplicate_count,
            COALESCE(SUM(c.used_in_answers_count), 0) AS used_in_answers_count
       FROM knowledge_source s
       LEFT JOIN knowledge_chunk c ON c.source_id = s.id
      WHERE s.workspace_id = ?
      GROUP BY s.id
      ORDER BY s.updated_at DESC`,
  )
    .bind(staleBefore, workspaceId)
    .all<Omit<KnowledgeSourceListItem, 'stale'> & { stale: number }>();

  return (rows.results ?? []).map((row) => ({ ...row, stale: row.stale === 1 }));
}

export type KnowledgeIngestInput = {
  kind: KnowledgeSourceKind;
  title?: string;
  body?: string;
  url?: string;
  r2Key?: string;
  ticketId?: string;
  messageId?: string;
  sourceId?: string;
};

export async function ingestKnowledgeSource(
  env: Env,
  workspaceId: string,
  input: KnowledgeIngestInput,
): Promise<KnowledgeIngestResult> {
  if (input.kind === 'url' && !input.url) throw new Error('url_required');
  if (input.kind !== 'url' && !input.body) throw new Error('body_required');

  const now = Date.now();
  let fetched: { title?: string; body?: string } = {};
  let lastCrawledAt: number | null = null;
  if (input.kind === 'url' && !input.body) {
    fetched = await fetchUrlDocument(input.url!);
    lastCrawledAt = now;
  }

  const title = normalizeWhitespace(
    input.title ?? fetched.title ?? input.url ?? 'Untitled source',
  ).slice(0, 300);
  const body = normalizeWhitespace(input.body ?? fetched.body ?? '');
  if (!body) throw new Error('empty_source_body');
  const sourceHash = await sha256Hex(body);

  const existing = await findExistingSource(env, workspaceId, input);
  const sourceId = existing?.id ?? input.sourceId ?? ids.knowledgeSource();
  if (!existing)
    await insertSourceShell(
      env,
      workspaceId,
      sourceId,
      input,
      title,
      sourceHash,
      lastCrawledAt,
      now,
    );

  const newVectorIds: string[] = [];
  try {
    const oldVectorIds = await listSourceVectorIds(env, sourceId, workspaceId);
    const chunkRows = await buildChunkRows(workspaceId, title, body);
    newVectorIds.push(...chunkRows.map((c) => c.vectorId));

    const vectorized = await upsertVectors(
      env,
      workspaceId,
      sourceId,
      input.kind,
      title,
      input.url,
      chunkRows,
    );
    await replaceSourceChunks(
      env,
      workspaceId,
      sourceId,
      input,
      title,
      sourceHash,
      lastCrawledAt,
      now,
      chunkRows,
      vectorized,
    );
    await deleteVectors(env, oldVectorIds);
    await mirrorLegacyDoc(env, workspaceId, sourceId, input.kind, title, body, input.url, now);
    return { sourceId, chunks: chunkRows.length, vectorized };
  } catch (error) {
    await deleteVectors(env, newVectorIds);
    await restoreOrFailSource(env, sourceId, workspaceId, existing, error);
    throw error;
  }
}

async function findExistingSource(env: Env, workspaceId: string, input: KnowledgeIngestInput) {
  return env.DB.prepare(
    `SELECT id, status, chunk_count, last_indexed_at
       FROM knowledge_source
      WHERE workspace_id = ?
        AND ((? IS NOT NULL AND kind = 'url' AND url = ?)
          OR (? IS NOT NULL AND kind = 'resolved_ticket' AND message_id = ?)
          OR (? IS NOT NULL AND kind = 'pdf' AND r2_key = ?)
          OR (? IS NOT NULL AND id = ?))
      LIMIT 1`,
  )
    .bind(
      workspaceId,
      input.url ?? null,
      input.url ?? null,
      input.messageId ?? null,
      input.messageId ?? null,
      input.r2Key ?? null,
      input.r2Key ?? null,
      input.sourceId ?? null,
      input.sourceId ?? null,
    )
    .first<{
      id: string;
      status: KnowledgeSourceListItem['status'];
      chunk_count: number;
      last_indexed_at: number | null;
    }>();
}

async function listSourceVectorIds(
  env: Env,
  sourceId: string,
  workspaceId: string,
): Promise<string[]> {
  const oldVectors = await env.DB.prepare(
    `SELECT vector_id FROM knowledge_chunk WHERE source_id = ? AND workspace_id = ?`,
  )
    .bind(sourceId, workspaceId)
    .all<{ vector_id: string }>();
  return (oldVectors.results ?? []).map((r) => r.vector_id);
}

async function restoreOrFailSource(
  env: Env,
  sourceId: string,
  workspaceId: string,
  existing: Awaited<ReturnType<typeof findExistingSource>>,
  error: unknown,
) {
  if (!existing || existing.status !== 'ready')
    return setSourceFailed(env, sourceId, workspaceId, error);
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(
    `UPDATE knowledge_source
        SET status = 'ready', chunk_count = ?, last_indexed_at = ?, error = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      existing.chunk_count,
      existing.last_indexed_at,
      message.slice(0, 1000),
      Date.now(),
      sourceId,
      workspaceId,
    )
    .run();
}

export async function importResolvedTickets(
  env: Env,
  workspaceId: string,
  limit = 50,
): Promise<ResolvedTicketImportResult> {
  const rows = await env.DB.prepare(
    `SELECT t.id AS ticket_id, t.subject, m.id AS message_id, m.preview, m.body_r2_key
       FROM ticket t
       JOIN message_index m ON m.ticket_id = t.id
      WHERE t.workspace_id = ? AND t.status IN ('resolved','closed') AND m.direction = 'outbound'
      ORDER BY m.sent_at DESC
      LIMIT ?`,
  )
    .bind(workspaceId, Math.min(Math.max(limit, 1), 200))
    .all<{
      ticket_id: string;
      subject: string;
      message_id: string;
      preview: string | null;
      body_r2_key: string | null;
    }>();

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const body = row.body_r2_key ? await getText(env, row.body_r2_key) : row.preview;
    if (!body || body.trim().length < 80) {
      skipped++;
      continue;
    }
    try {
      await ingestKnowledgeSource(env, workspaceId, {
        kind: 'resolved_ticket',
        title: `Resolved: ${row.subject}`,
        body,
        ticketId: row.ticket_id,
        messageId: row.message_id,
      });
      imported++;
    } catch (error) {
      console.warn('failed to import resolved ticket knowledge', row.ticket_id, error);
      failed++;
    }
  }
  return { imported, skipped, failed };
}
