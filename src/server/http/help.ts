import { Hono } from 'hono';
import { escapeHtml } from '../../lib/html-escape';
import { listPublicArticles, loadPublicArticle, workspaceIdBySlug } from '../actions/help-center';
import type { Env } from '../env';
import { markdownToHtml } from '../inbox/email/html';
import { HELP_COPY } from './customer-copy';

export const helpApp = new Hono<{ Bindings: Env }>();

async function rateLimited(c: { req: { header(n: string): string | undefined }; env: Env }) {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await c.env.RATE_LIMIT_INGEST?.limit({ key: `help:${ip}` }).catch(() => ({
    success: true,
  }));
  return rl ? !rl.success : false;
}

helpApp.get('/:slug', async (c) => {
  if (await rateLimited(c)) return page(HELP_COPY.rateLimited, 429);
  const workspaceId = await workspaceIdBySlug(c.env, c.req.param('slug'));
  if (!workspaceId) return page(HELP_COPY.centerMissing, 404);
  const articles = await listPublicArticles(c.env, workspaceId);
  const list = articles
    .map(
      (a) =>
        `<li style="margin-bottom:8px;"><a href="/help/${encodeURIComponent(c.req.param('slug'))}/${encodeURIComponent(a.id)}">${escapeHtml(a.title)}</a></li>`,
    )
    .join('');
  return page(
    `<h1 style="font-size:20px;margin:0 0 16px;">${HELP_COPY.title}</h1>
     ${articles.length ? `<ul style="padding-left:20px;">${list}</ul>` : `<p>${HELP_COPY.empty}</p>`}`,
    200,
  );
});

helpApp.get('/:slug/:id', async (c) => {
  if (await rateLimited(c)) return page(HELP_COPY.rateLimited, 429);
  const workspaceId = await workspaceIdBySlug(c.env, c.req.param('slug'));
  if (!workspaceId) return page(HELP_COPY.centerMissing, 404);
  const article = await loadPublicArticle(c.env, workspaceId, c.req.param('id'));
  if (!article) return page(HELP_COPY.articleMissing, 404);
  const sections = article.sections
    .map(
      (s) =>
        `<section style="margin-bottom:20px;">${
          s.title && s.title !== article.title
            ? `<h2 style="font-size:16px;margin:0 0 8px;">${escapeHtml(s.title)}</h2>`
            : ''
        }${markdownToHtml(s.body)}</section>`,
    )
    .join('');
  return page(
    `<p style="margin:0 0 12px;"><a href="/help/${encodeURIComponent(c.req.param('slug'))}">${HELP_COPY.backToList}</a></p>
     <h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(article.title)}</h1>
     ${sections}`,
    200,
  );
});

function page(body: string, status: number) {
  return new Response(
    `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;line-height:1.55;padding:32px;"><main style="max-width:640px;margin:0 auto;">${body}</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
