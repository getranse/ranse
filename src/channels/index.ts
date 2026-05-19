import type { Env } from '../env';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { ids } from '../lib/ids';
import { recordOutcome } from '../lib/outcomes';
import { getText, putRaw, r2Keys } from '../lib/storage';
import { emitEvent } from '../notifications/dispatch';
import {
  resumeWaitingProcedureRuns,
  startTriggeredProcedureRuns,
} from '../procedures/orchestration';
import type {
  PublicChannel,
  PublicChannelConfig,
  PublicChannelKind,
  PublicConversationSession,
  PublicSessionMessage,
} from '../types/channels';

const MESSAGE_LIMIT = 5000;
const SUBJECT_LIMIT = 180;

export async function listPublicChannels(env: Env, workspaceId: string): Promise<PublicChannel[]> {
  const rows = await env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.workspace_id = ?
      ORDER BY c.updated_at DESC`,
  )
    .bind(workspaceId)
    .all<PublicChannel>();
  return rows.results ?? [];
}

export async function createPublicChannel(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  input: {
    kind: PublicChannelKind;
    mailboxId: string;
    name: string;
    enabled?: boolean;
    requireEmail?: boolean;
    allowedOrigins?: string[];
    welcomeMessage?: string | null;
  },
): Promise<PublicChannel> {
  const mailbox = await getMailbox(env, workspaceId, input.mailboxId);
  if (!mailbox) throw new Error('mailbox_not_found');
  const now = Date.now();
  const id = ids.publicChannel();
  const publicKey = `pub_${randomToken(12)}`;
  await env.DB.prepare(
    `INSERT INTO public_channel (
       id, workspace_id, mailbox_id, kind, name, public_key, enabled,
       require_email, allowed_origins_json, welcome_message, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      input.mailboxId,
      input.kind,
      cleanText(input.name, 80) || `${input.kind === 'chat' ? 'Chat' : 'Form'} channel`,
      publicKey,
      input.enabled === false ? 0 : 1,
      input.requireEmail === false ? 0 : 1,
      JSON.stringify(normalizeOrigins(input.allowedOrigins ?? [])),
      cleanOptional(input.welcomeMessage, 240),
      now,
      now,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'public_channel.created',
    payload: { id, kind: input.kind, mailboxId: input.mailboxId },
  });
  const channel = await getPublicChannel(env, workspaceId, id);
  if (!channel) throw new Error('public_channel_create_failed');
  return channel;
}

export async function updatePublicChannel(
  env: Env,
  workspaceId: string,
  actorUserId: string,
  channelId: string,
  input: {
    name?: string;
    enabled?: boolean;
    requireEmail?: boolean;
    allowedOrigins?: string[];
    welcomeMessage?: string | null;
  },
): Promise<PublicChannel | null> {
  const current = await getPublicChannel(env, workspaceId, channelId);
  if (!current) return null;
  const next = {
    name: input.name === undefined ? current.name : cleanText(input.name, 80) || current.name,
    enabled: input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    requireEmail:
      input.requireEmail === undefined ? current.require_email : input.requireEmail ? 1 : 0,
    allowedOrigins:
      input.allowedOrigins === undefined
        ? current.allowed_origins_json
        : JSON.stringify(normalizeOrigins(input.allowedOrigins)),
    welcomeMessage:
      input.welcomeMessage === undefined
        ? current.welcome_message
        : cleanOptional(input.welcomeMessage, 240),
  };
  await env.DB.prepare(
    `UPDATE public_channel
        SET name = ?, enabled = ?, require_email = ?, allowed_origins_json = ?,
            welcome_message = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      next.name,
      next.enabled,
      next.requireEmail,
      next.allowedOrigins,
      next.welcomeMessage,
      Date.now(),
      channelId,
      workspaceId,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: 'user',
    actorId: actorUserId,
    action: 'public_channel.updated',
    payload: { channelId, enabled: next.enabled === 1 },
  });
  return getPublicChannel(env, workspaceId, channelId);
}

export async function publicChannelConfig(
  env: Env,
  publicKey: string,
  origin?: string | null,
): Promise<{ channel: PublicChannel; config: PublicChannelConfig } | null> {
  const channel = await getPublicChannelByKey(env, publicKey);
  if (!channel || channel.enabled !== 1 || !originAllowed(channel, origin)) return null;
  return {
    channel,
    config: {
      key: channel.public_key,
      kind: channel.kind,
      name: channel.name,
      require_email: channel.require_email === 1,
      welcome_message: channel.welcome_message,
    },
  };
}

export async function createPublicSession(
  env: Env,
  publicKey: string,
  input: {
    email?: string;
    name?: string;
    subject?: string;
    message: string;
    visitorId?: string | null;
  },
  meta: { origin?: string | null; userAgent?: string | null },
): Promise<{
  sessionId: string;
  sessionToken: string;
  ticketId: string;
  messageId: string;
  channel: PublicChannel;
}> {
  const channel = await getPublicChannelByKey(env, publicKey);
  if (!channel || channel.enabled !== 1) throw new Error('channel_not_found');
  if (!originAllowed(channel, meta.origin)) throw new Error('origin_not_allowed');
  const email = normalizeEmail(input.email);
  if (channel.require_email === 1 && !email) throw new Error('email_required');
  const message = cleanMessage(input.message, MESSAGE_LIMIT);
  if (!message) throw new Error('message_required');
  const now = Date.now();
  const subject = subjectForChannel(channel.kind, input.subject, message);
  const ticketId = ids.ticket();
  const messageId = ids.message();
  const sessionId = ids.publicSession();
  const requesterEmail = email ?? anonymousEmail(input.visitorId ?? sessionId);
  const requesterName = cleanOptional(input.name, 120);
  const sessionToken = `pst_${randomToken(24)}`;
  const tokenHash = await sha256Hex(sessionToken);
  const bodyKey = r2Keys.textBody(channel.workspace_id, ticketId, messageId);

  await putRaw(env, bodyKey, new TextEncoder().encode(message), 'text/plain; charset=utf-8');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ticket (
         id, workspace_id, mailbox_id, subject, status, priority, requester_email,
         requester_name, last_message_at, thread_token, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ticketId,
      channel.workspace_id,
      channel.mailbox_id,
      subject,
      requesterEmail,
      requesterName,
      now,
      ids.ticket().slice(4),
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO message_index (
         id, ticket_id, workspace_id, direction, from_address, to_address, subject,
         rfc_message_id, preview, body_r2_key, sent_at, created_at
       ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      messageId,
      ticketId,
      channel.workspace_id,
      requesterEmail,
      channel.mailbox_address ?? null,
      subject,
      `public:${sessionId}:${messageId}`,
      previewText(message),
      bodyKey,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO public_conversation_session (
         id, workspace_id, channel_id, ticket_id, session_token_hash,
         requester_email, requester_name, visitor_id, origin, user_agent,
         created_at, updated_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      channel.workspace_id,
      channel.id,
      ticketId,
      tokenHash,
      requesterEmail,
      requesterName,
      cleanOptional(input.visitorId, 160),
      cleanOptional(meta.origin, 300),
      cleanOptional(meta.userAgent, 500),
      now,
      now,
      now,
    ),
  ]);
  await emitChannelEvents(
    env,
    channel,
    ticketId,
    messageId,
    subject,
    requesterEmail,
    requesterName,
    message,
    true,
  );
  await startTriggeredProcedureRuns(env, channel.workspace_id, {
    ticketId,
    trigger: { type: 'ticket_created' },
    context: {
      ticket: { subject, requester_email: requesterEmail, requester_name: requesterName },
      inbound: { message_id: messageId, body: message },
      channel: { id: channel.id, kind: channel.kind, public_key: channel.public_key },
    },
    eventKey: `ticket_created:${ticketId}`,
  }).catch((err) => console.warn('failed to start channel triggered procedures', err));
  await audit(env, {
    workspaceId: channel.workspace_id,
    ticketId,
    actorType: 'system',
    action: 'public_channel.session_created',
    payload: { channelId: channel.id, channelKind: channel.kind, sessionId, messageId },
  });
  return { sessionId, sessionToken, ticketId, messageId, channel };
}

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
  await emitChannelEvents(
    env,
    channel,
    session.ticket_id,
    messageId,
    ticket.subject,
    session.requester_email,
    session.requester_name,
    message,
    false,
  );
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

export async function getPublicChannel(
  env: Env,
  workspaceId: string,
  channelId: string,
): Promise<PublicChannel | null> {
  return env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.workspace_id = ? AND c.id = ?`,
  )
    .bind(workspaceId, channelId)
    .first<PublicChannel>();
}

export function originAllowed(channel: PublicChannel, origin?: string | null): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  const allowed = parseOrigins(channel.allowed_origins_json);
  return allowed.length === 0 || allowed.includes(normalized);
}

export function normalizeOrigins(values: string[]): string[] {
  return [...new Set(values.map(normalizeOrigin).filter((value): value is string => !!value))];
}

async function getPublicChannelByKey(env: Env, publicKey: string): Promise<PublicChannel | null> {
  return env.DB.prepare(
    `SELECT c.*, m.address AS mailbox_address
       FROM public_channel c
       JOIN mailbox m ON m.id = c.mailbox_id AND m.workspace_id = c.workspace_id
      WHERE c.public_key = ?`,
  )
    .bind(publicKey)
    .first<PublicChannel>();
}

async function getMailbox(env: Env, workspaceId: string, mailboxId: string) {
  return env.DB.prepare(`SELECT id, address FROM mailbox WHERE id = ? AND workspace_id = ?`)
    .bind(mailboxId, workspaceId)
    .first<{ id: string; address: string }>();
}

async function getSessionByToken(
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

async function emitChannelEvents(
  env: Env,
  channel: PublicChannel,
  ticketId: string,
  messageId: string,
  subject: string,
  requesterEmail: string,
  requesterName: string | null,
  message: string,
  isNewTicket: boolean,
) {
  const preview = previewText(message);
  if (isNewTicket) {
    await emitEvent(env, channel.workspace_id, 'ticket.created', {
      ticketId,
      subject,
      requesterEmail,
      requesterName,
      preview,
      mailboxAddress: channel.mailbox_address ?? '',
      receivedAt: Date.now(),
    });
  }
  await emitEvent(env, channel.workspace_id, 'message.inbound', {
    ticketId,
    messageId,
    subject,
    fromAddress: requesterEmail,
    fromName: requesterName,
    preview,
    isReplyToExisting: !isNewTicket,
    receivedAt: Date.now(),
  });
}

function subjectForChannel(kind: PublicChannelKind, subject: string | undefined, message: string) {
  const explicit = cleanText(subject ?? '', SUBJECT_LIMIT);
  if (explicit) return explicit;
  const firstLine = cleanText(message.split(/\r?\n/)[0] ?? '', 80);
  return `${kind === 'chat' ? 'Chat' : 'Form'}: ${firstLine || 'New conversation'}`;
}

function normalizeEmail(value?: string): string | null {
  const email = value?.trim().toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function anonymousEmail(seed: string): string {
  return `visitor-${seed
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-16)
    .toLowerCase()}@public.ranse.local`;
}

function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMessage(value: string, max: number): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max);
}

function cleanOptional(value: string | null | undefined, max: number): string | null {
  const clean = cleanText(value ?? '', max);
  return clean || null;
}

function previewText(value: string): string {
  return cleanText(value, 280);
}

function parseOrigins(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalizeOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
