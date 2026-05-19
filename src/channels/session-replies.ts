import type { Env } from '../env';
import { audit } from '../lib/audit';
import { sha256Hex } from '../lib/crypto';
import { ids } from '../lib/ids';
import { recordOutcome } from '../lib/outcomes';
import { getText, putRaw, r2Keys } from '../lib/storage';
import { emitEvent } from '../notifications/dispatch';
import { resumeWaitingProcedureRuns } from '../procedures/orchestration';
import type { PublicConversationSession, PublicSessionMessage } from '../types/channels';
import { getPublicChannel } from './lookup';
import { cleanMessage, originAllowed, previewText } from './utils';

const MESSAGE_LIMIT = 5000;

// Follow-up messages on an existing chat/form session. Split out of
// `sessions.ts` so each file owns one concern (create vs. continue).

export async function appendPublicSessionMessage(
  env: Env,
  sessionId: string,
  sessionToken: string,
  input: { message: string },
  meta: { origin?: string | null },
): Promise<{ messageId: string; ticketId: string }> {
  const session = await getSessionByToken(env, sessionId, sessionToken);
  if (!session) throw new Error('session_not_found');
  const channel = await getPublicChannel(env, session.workspace_id, session.channel_id);
  if (!channel || channel.enabled !== 1) throw new Error('channel_not_found');
  if (!originAllowed(channel, meta.origin)) throw new Error('origin_not_allowed');
  const message = cleanMessage(input.message, MESSAGE_LIMIT);
  if (!message) throw new Error('message_required');
  const ticket = await env.DB.prepare(
    `SELECT subject, status FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(session.ticket_id, session.workspace_id)
    .first<{ subject: string; status: string }>();
  if (!ticket) throw new Error('ticket_not_found');
  const now = Date.now();
  const messageId = ids.message();
  const bodyKey = r2Keys.textBody(session.workspace_id, session.ticket_id, messageId);
  await putRaw(env, bodyKey, new TextEncoder().encode(message), 'text/plain; charset=utf-8');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO message_index (
         id, ticket_id, workspace_id, direction, from_address, to_address, subject,
         rfc_message_id, preview, body_r2_key, sent_at, created_at
       ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      messageId,
      session.ticket_id,
      session.workspace_id,
      session.requester_email,
      channel.mailbox_address ?? null,
      ticket.subject,
      `public:${session.id}:${messageId}`,
      previewText(message),
      bodyKey,
      now,
      now,
    ),
    env.DB.prepare(
      `UPDATE ticket SET status = 'open', last_message_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status != 'spam'`,
    ).bind(now, now, session.ticket_id, session.workspace_id),
    env.DB.prepare(
      `UPDATE public_conversation_session SET updated_at = ?, last_seen_at = ?
        WHERE id = ? AND workspace_id = ?`,
    ).bind(now, now, session.id, session.workspace_id),
  ]);
  if (['pending', 'resolved', 'closed'].includes(ticket.status)) {
    await recordOutcome(env, {
      workspaceId: session.workspace_id,
      ticketId: session.ticket_id,
      kind: 'customer_followed_up',
      source: 'system',
      payload: { messageId, previousStatus: ticket.status, channelId: channel.id },
    });
  }
  await emitEvent(env, channel.workspace_id, 'message.inbound', {
    ticketId: session.ticket_id,
    messageId,
    subject: ticket.subject,
    fromAddress: session.requester_email,
    fromName: session.requester_name,
    preview: previewText(message),
    isReplyToExisting: true,
    receivedAt: Date.now(),
  });
  await resumeWaitingProcedureRuns(env, session.workspace_id, {
    ticketId: session.ticket_id,
    event: 'customer_reply',
    payload: { messageId, subject: ticket.subject, from: session.requester_email },
  }).catch((err) => console.warn('failed to resume channel procedures', err));
  await audit(env, {
    workspaceId: session.workspace_id,
    ticketId: session.ticket_id,
    actorType: 'system',
    action: 'public_channel.message_received',
    payload: { channelId: channel.id, sessionId: session.id, messageId },
  });
  return { messageId, ticketId: session.ticket_id };
}

export async function publicSessionMessages(
  env: Env,
  sessionId: string,
  sessionToken: string,
  meta: { origin?: string | null } = {},
): Promise<{ session: PublicConversationSession; messages: PublicSessionMessage[] } | null> {
  const session = await getSessionByToken(env, sessionId, sessionToken);
  if (!session) return null;
  const channel = await getPublicChannel(env, session.workspace_id, session.channel_id);
  if (!channel || channel.enabled !== 1) return null;
  if (!originAllowed(channel, meta.origin)) throw new Error('origin_not_allowed');
  await env.DB.prepare(
    `UPDATE public_conversation_session SET last_seen_at = ? WHERE id = ? AND workspace_id = ?`,
  )
    .bind(Date.now(), session.id, session.workspace_id)
    .run();
  const rows = await env.DB.prepare(
    `SELECT id, direction, preview, body_r2_key, from_address, to_address, sent_at
       FROM message_index
      WHERE workspace_id = ? AND ticket_id = ? AND direction IN ('inbound','outbound')
      ORDER BY sent_at ASC`,
  )
    .bind(session.workspace_id, session.ticket_id)
    .all<PublicSessionMessage & { body_r2_key?: string | null }>();
  const messages = await Promise.all(
    (rows.results ?? []).map(async ({ body_r2_key, ...message }) => ({
      ...message,
      body: body_r2_key ? ((await getText(env, body_r2_key)) ?? message.preview) : message.preview,
    })),
  );
  return { session, messages };
}

export async function getSessionByToken(
  env: Env,
  sessionId: string,
  sessionToken: string,
): Promise<PublicConversationSession | null> {
  if (!sessionToken.startsWith('pst_')) return null;
  const tokenHash = await sha256Hex(sessionToken);
  return env.DB.prepare(
    `SELECT * FROM public_conversation_session WHERE id = ? AND session_token_hash = ?`,
  )
    .bind(sessionId, tokenHash)
    .first<PublicConversationSession>();
}
