import type { Context, Hono } from 'hono';
import {
  extractTextFromPdfBytes,
  agenticSearchKnowledge,
  importResolvedTickets,
  ingestKnowledgeSource,
  listKnowledgeSources,
} from '../../automation/knowledge';
import type { Env } from '../../env';
import { ids } from '../../../lib/ids';
import { apiError } from '../../../lib/errors';
import { r2Keys, putRaw, getText } from '../../../lib/storage';
import { OWNER_OR_ADMIN, type Ctx, requireWorkspaceRole } from './context';
import { readUploadedFile, safeFilename, titleFromFilename } from '../../../lib/files';
import { audit, auditContext } from '../../actions/audit';
import { createSourceBody, importResolvedBody, searchBody } from '../../schemas/knowledge';
import { MAX_KNOWLEDGE_PDF_BYTES } from '../../../config/knowledge';

export function registerKnowledgeRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/knowledge', async (c) => {
    const s = c.get('session');
    const sources = await listKnowledgeSources(c.env, s.workspaceId);
    return c.json({ sources, docs: sources });
  });

  apiApp.get('/knowledge/:id/file', async (c) => {
    const s = c.get('session');
    const row = await c.env.DB.prepare(
      `SELECT title, r2_key FROM knowledge_source WHERE id = ? AND workspace_id = ? AND kind = 'pdf'`,
    )
      .bind(c.req.param('id'), s.workspaceId)
      .first<{ title: string; r2_key: string | null }>();
    if (!row?.r2_key) return apiError(c, 'not_found', 'PDF source not found.');
    const obj = await c.env.BLOB.get(row.r2_key);
    if (!obj) return apiError(c, 'not_found', 'PDF file not found in R2.');
    return new Response(await obj.arrayBuffer(), {
      headers: {
        'content-type': obj.httpMetadata?.contentType || 'application/pdf',
        'content-disposition': `inline; filename="${safeFilename(`${row.title || 'source'}.pdf`)}"`,
      },
    });
  });

  // Single knowledge-creation endpoint. PDF uploads arrive as multipart/form-data;
  // manual + url sources as JSON. The transport differs because a PDF carries bytes
  // to extract, but both kinds funnel into ingestKnowledgeSource.
  apiApp.post('/knowledge', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    if ((c.req.header('content-type') ?? '').includes('multipart/form-data')) {
      return createKnowledgeFromPdf(c, s.workspaceId);
    }
    const body = createSourceBody.parse(await c.req.json());
    const result = await ingestKnowledgeSource(c.env, s.workspaceId, body);
    await audit(c.env, {
      workspaceId: s.workspaceId,
      actorType: 'user',
      actorId: s.userId,
      action: 'knowledge.source_created',
      payload: { id: result.sourceId, kind: body.kind, title: body.title },
      context: auditContext(c),
    });
    return c.json({ ok: true, id: result.sourceId, ...result });
  });

  apiApp.post('/knowledge/:id/reindex', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const source = await findKnowledgeSource(c.env, s.workspaceId, c.req.param('id'));
    if (!source) return apiError(c, 'not_found', 'Knowledge source not found.');
    const body = await loadSourceBodyOrError(c, s.workspaceId, source);
    if (body instanceof Response) return body;
    const result = await ingestKnowledgeSource(c.env, s.workspaceId, {
      sourceId: source.id,
      kind: source.kind,
      title: source.title,
      body,
      url: source.url ?? undefined,
      r2Key: source.r2_key ?? undefined,
      ticketId: source.ticket_id ?? undefined,
      messageId: source.message_id ?? undefined,
    });
    await audit(c.env, {
      workspaceId: s.workspaceId,
      actorType: 'user',
      actorId: s.userId,
      action: 'knowledge.source_reindexed',
      payload: { id: source.id, kind: source.kind },
      context: auditContext(c),
    });
    return c.json({ ok: true, id: result.sourceId, ...result });
  });

  apiApp.post('/knowledge/search', async (c) => {
    const s = c.get('session');
    const body = searchBody.parse(await c.req.json());
    const result = await agenticSearchKnowledge(c.env, s.workspaceId, body.query, {
      limit: body.limit ?? 5,
      maxHops: body.max_hops ?? 3,
      scope: body.scope,
    });
    return c.json(result);
  });

  apiApp.post(
    '/knowledge/import-resolved-tickets',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const body = importResolvedBody.parse(await c.req.json().catch(() => ({})));
      return c.json({
        ok: true,
        ...(await importResolvedTickets(c.env, s.workspaceId, body.limit ?? 50)),
      });
    },
  );
}

async function createKnowledgeFromPdf(c: Context<Ctx>, workspaceId: string): Promise<Response> {
  const uploaded = await readUploadedFile(c, {
    maxBytes: MAX_KNOWLEDGE_PDF_BYTES,
    validate: (f) =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') ? null : 'Use a PDF file.',
  });
  if (uploaded instanceof Response) return uploaded;
  const { form, file, bytes } = uploaded;
  const text = await extractPdfTextOrError(c, bytes);
  if (text instanceof Response) return text;

  const sourceId = ids.knowledgeSource();
  const key = r2Keys.knowledgePdf(workspaceId, sourceId, safeFilename(file.name || `${sourceId}.pdf`));
  await putRaw(c.env, key, bytes, 'application/pdf');

  try {
    const result = await ingestKnowledgeSource(c.env, workspaceId, {
      sourceId,
      kind: 'pdf',
      title: String(form.get('title') ?? '').trim() || titleFromFilename(file.name),
      body: text,
      r2Key: key,
    });
    await audit(c.env, {
      workspaceId,
      actorType: 'user',
      actorId: c.get('session').userId,
      action: 'knowledge.source_created',
      payload: { id: result.sourceId, kind: 'pdf', filename: file.name },
      context: auditContext(c),
    });
    return c.json({ ok: true, id: result.sourceId, ...result });
  } catch (err) {
    await c.env.BLOB.delete(key).catch(() => undefined);
    return apiError(
      c,
      'knowledge_index_failed',
      err instanceof Error ? err.message : 'Could not index that PDF.',
      500,
    );
  }
}

async function extractPdfTextOrError(
  c: Context<Ctx>,
  bytes: ArrayBuffer,
): Promise<string | Response> {
  try {
    return await extractTextFromPdfBytes(bytes);
  } catch (err) {
    return apiError(
      c,
      'pdf_text_failed',
      err instanceof Error ? err.message : 'Could not extract text from that PDF.',
      400,
    );
  }
}

async function findKnowledgeSource(env: Env, workspaceId: string, sourceId: string) {
  return env.DB.prepare(
    `SELECT id, kind, title, url, r2_key, ticket_id, message_id
       FROM knowledge_source
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(sourceId, workspaceId)
    .first<{
      id: string;
      kind: 'manual' | 'url' | 'pdf' | 'resolved_ticket';
      title: string;
      url: string | null;
      r2_key: string | null;
      ticket_id: string | null;
      message_id: string | null;
    }>();
}

async function sourceBodyFromChunks(
  env: Env,
  workspaceId: string,
  sourceId: string,
): Promise<string | null> {
  const rows = await env.DB.prepare(
    `SELECT body FROM knowledge_chunk WHERE workspace_id = ? AND source_id = ? ORDER BY ordinal ASC`,
  )
    .bind(workspaceId, sourceId)
    .all<{ body: string }>();
  return (
    (rows.results ?? [])
      .map((r) => r.body)
      .join('\n\n')
      .trim() || null
  );
}

async function loadSourceBody(
  env: Env,
  workspaceId: string,
  source: NonNullable<Awaited<ReturnType<typeof findKnowledgeSource>>>,
): Promise<string | undefined> {
  if (source.kind === 'manual') {
    const doc = await env.DB.prepare(
      `SELECT body FROM knowledge_doc WHERE id = ? AND workspace_id = ?`,
    )
      .bind(source.id, workspaceId)
      .first<{ body: string }>();
    return doc?.body ?? (await sourceBodyFromChunks(env, workspaceId, source.id)) ?? undefined;
  }
  if (source.kind === 'pdf') {
    if (!source.r2_key) throw new Error('missing_pdf');
    const obj = await env.BLOB.get(source.r2_key);
    if (!obj) throw new Error('pdf_not_found');
    return extractTextFromPdfBytes(await obj.arrayBuffer());
  }
  if (source.kind === 'resolved_ticket') {
    const msg = await env.DB.prepare(
      `SELECT preview, body_r2_key FROM message_index WHERE id = ? AND workspace_id = ?`,
    )
      .bind(source.message_id, workspaceId)
      .first<{ preview: string | null; body_r2_key: string | null }>();
    return msg?.body_r2_key
      ? ((await getText(env, msg.body_r2_key)) ?? undefined)
      : (msg?.preview ?? undefined);
  }
  return undefined;
}

async function loadSourceBodyOrError(
  c: Context<Ctx>,
  workspaceId: string,
  source: NonNullable<Awaited<ReturnType<typeof findKnowledgeSource>>>,
): Promise<string | undefined | Response> {
  try {
    return await loadSourceBody(c.env, workspaceId, source);
  } catch (err) {
    if (err instanceof Error && err.message === 'missing_pdf') {
      return apiError(c, 'missing_pdf', 'This PDF source has no R2 object key.', 409);
    }
    if (err instanceof Error && err.message === 'pdf_not_found') {
      return apiError(c, 'not_found', 'PDF file not found in R2.');
    }
    return apiError(
      c,
      'source_body_failed',
      err instanceof Error ? err.message : 'Could not load source body.',
      500,
    );
  }
}
