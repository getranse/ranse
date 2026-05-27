import { Hono } from 'hono';
import type { Env } from '../env';
import { verifyFeedbackToken } from '../lib/feedback-links';
import { recordCustomerFeedback } from '../outcomes';

export const feedbackApp = new Hono<{ Bindings: Env }>();

feedbackApp.get('/', async (c) => {
  const token = c.req.query('token');
  if (!token) return feedbackPage('Feedback link is missing.', 400);

  const payload = await verifyFeedbackToken(c.env, token);
  if (!payload) return feedbackPage('Feedback link is invalid or expired.', 400);

  const valid = await messageBelongsToTicket(
    c.env,
    payload.workspaceId,
    payload.ticketId,
    payload.messageId,
  );
  if (!valid) return feedbackPage('Feedback link is no longer valid.', 404);

  await recordCustomerFeedback(c.env, {
    workspaceId: payload.workspaceId,
    ticketId: payload.ticketId,
    messageId: payload.messageId,
    rating: payload.rating,
  });

  return feedbackPage('Thanks. Your feedback was recorded.', 200);
});

async function messageBelongsToTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
  messageId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM message_index
      WHERE id = ? AND ticket_id = ? AND workspace_id = ? AND direction = 'outbound'`,
  )
    .bind(messageId, ticketId, workspaceId)
    .first<{ id: string }>();
  return !!row;
}

function feedbackPage(message: string, status: number) {
  return new Response(
    `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;padding:32px;"><main style="max-width:520px;margin:0 auto;"><h1 style="font-size:20px;margin:0 0 12px;">Ranse feedback</h1><p style="font-size:15px;line-height:1.5;">${message}</p></main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
