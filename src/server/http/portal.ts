import { Hono } from 'hono';
import { escapeHtml } from '../../lib/html-escape';
import { verifyPortalToken } from '../../lib/portal-links';
import { loadPortalTicket } from '../actions/portal';
import type { Env } from '../env';

export const portalApp = new Hono<{ Bindings: Env }>();

const STATUS_LABEL: Record<string, string> = {
  open: 'Open — we are on it',
  pending: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
  spam: 'Closed',
};

portalApp.get('/', async (c) => {
  const token = c.req.query('token');
  const payload = token ? await verifyPortalToken(c.env, token) : null;
  if (!payload) return page('This link is invalid or has expired.', 400);

  const view = await loadPortalTicket(c.env, payload.workspaceId, payload.ticketId);
  if (!view) return page('This request is no longer available.', 404);

  const messages = view.messages
    .map(
      (m) => `<div style="margin-bottom:14px;">
        <div style="font-size:12px;color:#64748b;">${m.direction === 'inbound' ? 'You' : escapeHtml(view.workspace_name)} · ${new Date(m.sent_at).toUTCString()}</div>
        <div style="white-space:pre-wrap;">${escapeHtml(m.preview ?? '')}</div>
      </div>`,
    )
    .join('');

  return page(
    `<p style="margin:0 0 4px;font-size:13px;color:#64748b;">${escapeHtml(view.workspace_name)} support</p>
     <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(view.subject)}</h2>
     <p style="margin:0 0 20px;font-size:13px;"><strong>${escapeHtml(STATUS_LABEL[view.status] ?? view.status)}</strong></p>
     ${messages}
     <p style="font-size:13px;color:#64748b;">To add more detail, just reply to any email from us on this request.</p>`,
    200,
  );
});

function page(body: string, status: number) {
  return new Response(
    `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;padding:32px;"><main style="max-width:560px;margin:0 auto;">${body}</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
