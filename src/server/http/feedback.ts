import { Hono } from 'hono';
import { verifyFeedbackToken } from '../../lib/feedback-links';
import { recordFeedbackSurvey } from '../actions/feedback';
import type { Env } from '../env';
import { recordCustomerFeedback } from '../platform/outcomes';
import { surveyBody } from '../schemas/feedback';

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

  return feedbackPage(`Thanks. Your feedback was recorded.${surveyFormHtml(token)}`, 200);
});

feedbackApp.post('/survey', async (c) => {
  const form = surveyBody.safeParse(Object.fromEntries((await c.req.formData()).entries()));
  if (!form.success) return feedbackPage('That survey response looks invalid.', 400);

  const payload = await verifyFeedbackToken(c.env, form.data.token);
  if (!payload) return feedbackPage('Feedback link is invalid or expired.', 400);

  const recorded = await recordFeedbackSurvey(c.env, {
    workspaceId: payload.workspaceId,
    ticketId: payload.ticketId,
    messageId: payload.messageId,
    score: form.data.score,
    comment: form.data.comment,
  });
  if (!recorded) return feedbackPage('Feedback link is no longer valid.', 404);
  return feedbackPage('Thanks — your rating was recorded.', 200);
});

// The survey renders after the thumbs click so a plain link-click still
// records something even when the customer never fills the form.
function surveyFormHtml(token: string): string {
  const scores = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<label style="margin-right:10px;"><input type="radio" name="score" value="${n}" required> ${n}</label>`,
    )
    .join('');
  return `<form method="post" action="/feedback/survey" style="margin-top:20px;">
    <input type="hidden" name="token" value="${token.replace(/"/g, '&quot;')}">
    <p style="font-size:14px;margin:0 0 8px;">How would you rate this support experience? (1 = poor, 5 = great)</p>
    <div style="font-size:14px;margin-bottom:10px;">${scores}</div>
    <textarea name="comment" rows="3" maxlength="2000" placeholder="Anything to add? (optional)" style="width:100%;font:inherit;padding:6px;"></textarea>
    <button type="submit" style="margin-top:10px;padding:6px 14px;font:inherit;">Send rating</button>
  </form>`;
}

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
