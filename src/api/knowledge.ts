import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  extractTextFromPdfBytes,
  importResolvedTickets,
  ingestKnowledgeSource,
  listKnowledgeSources,
  searchKnowledge,
} from '../knowledge';
import type { Env } from '../env';
import { ids } from '../lib/ids';
import { apiError } from '../lib/errors';
import { r2Keys, putRaw, getText } from '../lib/storage';
import type { Ctx } from './context';
import { safeFilename, titleFromFilename } from './files';

const MAX_KNOWLEDGE_PDF_BYTES = 10 * 1024 * 1024;

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

  apiApp.post('/knowledge', async (c) => {
    const s = c.get('session');
    const body = z.object({
      kind: z.enum(['manual', 'url']).default('manual'),
      title: z.string().min(1).max(300).optional(),
      body: z.string().min(1).max(500000).optional(),
      url: z.string().url().max(2000).optional(),
    }).superRefine((value, ctx) => {
      if (value.kind === 'manual' && !value.body) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: 'Manual sources need a body.' });
      }
      if (value.kind === 'url' && !value.url) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'URL sources need a URL.' });
      }
    }).parse(await c.req.json());
    const result = await ingestKnowledgeSource(c.env, s.workspaceId, body);
    return c.json({ ok: true, id: result.sourceId, ...result });
  });

  apiApp.post('/knowledge/pdf', async (c) => {
    const s = c.get('session');
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return apiError(c, 'no_file', 'Attach a PDF under the "file" field.', 400);
    if (file.size > MAX_KNOWLEDGE_PDF_BYTES) return apiError(c, 'too_large', 'PDF must be under 10MB.', 413);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return apiError(c, 'invalid_type', 'Use a PDF file.', 400);
    }

    const bytes = await file.arrayBuffer();
    const text = await extractPdfTextOrError(c, bytes);
    if (text instanceof Response) return text;

    const sourceId = ids.knowledgeSource();
    const key = r2Keys.knowledgePdf(s.workspaceId, sourceId, safeFilename(file.name || `${sourceId}.pdf`));
    await putRaw(c.env, key, bytes, 'application/pdf');

    try {
      const result = await ingestKnowledgeSource(c.env, s.workspaceId, {
        sourceId,
        kind: 'pdf',
        title: String(form.get('title') ?? '').trim() || titleFromFilename(file.name),
        body: text,
        r2Key: key,
      });
      return c.json({ ok: true, id: result.sourceId, ...result });
    } catch (err) {
      await c.env.BLOB.delete(key).catch(() => undefined);
      return apiError(c, 'knowledge_index_failed', err instanceof Error ? err.message : 'Could not index that PDF.', 500);
    }
  });

  apiApp.post('/knowledge/:id/reindex', async (c) => {
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
    return c.json({ ok: true, id: result.sourceId, ...result });
  });

  apiApp.post('/knowledge/search', async (c) => {
    const s = c.get('session');
    const body = z.object({ query: z.string().min(1).max(4000), limit: z.number().int().min(1).max(20).optional() })
      .parse(await c.req.json());
    return c.json({ hits: await searchKnowledge(c.env, s.workspaceId, body.query, body.limit ?? 5) });
  });

  apiApp.post('/knowledge/import-resolved-tickets', async (c) => {
    const s = c.get('session');
    const body = z.object({ limit: z.number().int().min(1).max(200).optional() })
      .parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, ...(await importResolvedTickets(c.env, s.workspaceId, body.limit ?? 50)) });
  });
}

async function extractPdfTextOrError(c: Context<Ctx>, bytes: ArrayBuffer): Promise<string | Response> {
  try {
    return await extractTextFromPdfBytes(bytes);
  } catch (err) {
    return apiError(c, 'pdf_text_failed', err instanceof Error ? err.message : 'Could not extract text from that PDF.', 400);
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

async function sourceBodyFromChunks(env: Env, workspaceId: string, sourceId: string): Promise<string | null> {
  const rows = await env.DB.prepare(
    `SELECT body FROM knowledge_chunk WHERE workspace_id = ? AND source_id = ? ORDER BY ordinal ASC`,
  )
    .bind(workspaceId, sourceId)
    .all<{ body: string }>();
  return (rows.results ?? []).map((r) => r.body).join('\n\n').trim() || null;
}

async function loadSourceBody(env: Env, workspaceId: string, source: NonNullable<Awaited<ReturnType<typeof findKnowledgeSource>>>): Promise<string | undefined> {
  if (source.kind === 'manual') {
    const doc = await env.DB.prepare(`SELECT body FROM knowledge_doc WHERE id = ? AND workspace_id = ?`)
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
    const msg = await env.DB.prepare(`SELECT preview, body_r2_key FROM message_index WHERE id = ? AND workspace_id = ?`)
      .bind(source.message_id, workspaceId)
      .first<{ preview: string | null; body_r2_key: string | null }>();
    return msg?.body_r2_key ? await getText(env, msg.body_r2_key) ?? undefined : msg?.preview ?? undefined;
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
    return apiError(c, 'source_body_failed', err instanceof Error ? err.message : 'Could not load source body.', 500);
  }
}
