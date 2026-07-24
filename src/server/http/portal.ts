import { Hono } from 'hono';
import { escapeHtml } from '../../lib/html-escape';
import { verifyPortalToken } from '../../lib/portal-links';
import { loadPortalTicket } from '../actions/portal';
import type { Env } from '../env';
import { PORTAL_COPY } from './customer-copy';

export const portalApp = new Hono<{ Bindings: Env }>();

portalApp.get('/', async (c) => {
  const token = c.req.query('token');
  const payload = token ? await verifyPortalToken(c.env, token) : null;
  if (!payload) return page(PORTAL_COPY.invalidLink, 400);

  const view = await loadPortalTicket(c.env, payload.workspaceId, payload.ticketId);
  if (!view) return page(PORTAL_COPY.gone, 404);

  const messages = view.messages
    .map(
      (m) => `<div style="margin-bottom:14px;">
        <div style="font-size:12px;color:#64748b;">${m.direction === 'inbound' ? PORTAL_COPY.you : escapeHtml(view.workspace_name)} · ${new Date(m.sent_at).toUTCString()}</div>
        <div style="white-space:pre-wrap;">${escapeHtml(m.preview ?? '')}</div>
      </div>`,
    )
    .join('');

  return page(
    `<p style="margin:0 0 4px;font-size:13px;color:#64748b;">${escapeHtml(view.workspace_name)} support</p>
     <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(view.subject)}</h2>
     <p style="margin:0 0 20px;font-size:13px;"><strong>${escapeHtml(PORTAL_COPY.status[view.status] ?? view.status)}</strong></p>
     ${messages}
     <p style="font-size:13px;color:#64748b;">${PORTAL_COPY.replyHint}</p>`,
    200,
  );
});

function page(body: string, status: number) {
  return new Response(
    `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;padding:32px;"><main style="max-width:560px;margin:0 auto;">${body}</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
