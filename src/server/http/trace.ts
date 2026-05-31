import { Hono } from 'hono';
import type { Env } from '../env';
import { buildPublicTrace, verifyTraceToken } from '../actions/decision-trace';
import { renderTracePage } from '../../lib/decision-trace-page';

// Public, unauthenticated decision-trace surface. Mounted at /public/trace/:token.
// We split into its own Hono so it sits under /public alongside channel
// webhooks; no cookies, no auth, HMAC-signed token does the gatekeeping.

export const traceApp = new Hono<{ Bindings: Env }>();

traceApp.get('/trace/:token', async (c) => {
  const token = c.req.param('token');
  const payload = await verifyTraceToken(c.env, token);
  if (!payload) return errorPage('Trace link is invalid or expired.', 404);
  const trace = await buildPublicTrace(c.env, payload);
  if (!trace) return errorPage('Trace link is no longer valid.', 404);
  return new Response(renderTracePage(trace), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Prevent search-engine indexing; the URL is one-off but the content
      // describes a specific support interaction.
      'x-robots-tag': 'noindex',
      // No referer leakage when the customer clicks an outbound link.
      'referrer-policy': 'no-referrer',
    },
  });
});

function errorPage(message: string, status: number) {
  return new Response(
    `<!doctype html><html lang="en"><body style="font-family:ui-sans-serif,system-ui,sans-serif;padding:32px;color:#0f172a"><main style="max-width:520px;margin:0 auto"><h1 style="font-size:20px;margin:0 0 12px">Decision trace</h1><p style="font-size:15px;line-height:1.5">${message}</p></main></body></html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
    },
  );
}
