import type { Env } from '../env';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { ids } from '../lib/ids';
import { putRaw, r2Keys } from '../lib/storage';
import { emitEvent } from '../notifications/dispatch';
import { startTriggeredProcedureRuns } from '../procedures/orchestration';
import type { ChannelKind, PublicChannel } from '../../types/channels';
import { resolveCustomerIdentity } from './identity';
import { getPublicChannelByKey } from './lookup';
import { tryGetAdapter } from './registry';
import {
  anonymousEmail,
  cleanMessage,
  cleanOptional,
  cleanText,
  normalizeEmail,
  originAllowed,
  previewText,
} from './utils';

// Session-based public surfaces — the embeddable widget (`chat`) and hosted
// form (`form`). These do not use third-party providers; replies come back
// via the same polling endpoint the widget already uses, so they don't go
// through the outbound dispatcher.

const MESSAGE_LIMIT = 5000;
const SUBJECT_LIMIT = 180;

export async function publicChannelConfig(env: Env, publicKey: string, origin?: string | null) {
  const channel = await getPublicChannelByKey(env, publicKey);
  if (!channel || channel.enabled !== 1 || !originAllowed(channel, origin)) return null;
  const adapter = tryGetAdapter(channel.kind);
  if (!adapter) return null;
  return {
    channel,
    config: {
      key: channel.public_key,
      kind: channel.kind,
      name: channel.name,
      require_email: channel.require_email === 1,
      welcome_message: channel.welcome_message,
      capabilities: adapter.capabilities,
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
  if (channel.kind !== 'chat' && channel.kind !== 'form') {
    throw new Error('channel_kind_not_session_based');
  }
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

  const identity = await resolveCustomerIdentity(env, {
    workspaceId: channel.workspace_id,
    channelKind: channel.kind,
    externalId: input.visitorId ?? sessionId,
    displayName: requesterName,
    email,
    phone: null,
  });

  await putRaw(env, bodyKey, new TextEncoder().encode(message), 'text/plain; charset=utf-8');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ticket (
         id, workspace_id, mailbox_id, subject, status, priority, requester_email,
         requester_name, last_message_at, thread_token, customer_id,
         origin_channel_kind, origin_channel_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ticketId,
      channel.workspace_id,
      channel.mailbox_id,
      subject,
      channel.default_priority ?? 'normal',
      requesterEmail,
      requesterName,
      now,
      ids.ticket().slice(4),
      identity.customerId,
      channel.kind,
      channel.id,
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
  await emitInitialEvents(env, channel, {
    ticketId,
    messageId,
    subject,
    requesterEmail,
    requesterName,
    message,
  });
  await startTriggeredProcedureRuns(env, channel.workspace_id, {
    ticketId,
    trigger: { type: 'ticket_created' },
    context: {
      ticket: { subject, requester_email: requesterEmail, requester_name: requesterName },
      inbound: { message_id: messageId, body: message },
      channel: {
        id: channel.id,
        kind: channel.kind,
        public_key: channel.public_key,
        capabilities: tryGetAdapter(channel.kind)?.capabilities ?? null,
      },
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

async function emitInitialEvents(
  env: Env,
  channel: PublicChannel,
  args: {
    ticketId: string;
    messageId: string;
    subject: string;
    requesterEmail: string;
    requesterName: string | null;
    message: string;
  },
) {
  const preview = previewText(args.message);
  await emitEvent(env, channel.workspace_id, 'ticket.created', {
    ticketId: args.ticketId,
    subject: args.subject,
    requesterEmail: args.requesterEmail,
    requesterName: args.requesterName,
    preview,
    mailboxAddress: channel.mailbox_address ?? '',
    receivedAt: Date.now(),
  });
  await emitEvent(env, channel.workspace_id, 'message.inbound', {
    ticketId: args.ticketId,
    messageId: args.messageId,
    subject: args.subject,
    fromAddress: args.requesterEmail,
    fromName: args.requesterName,
    preview,
    isReplyToExisting: false,
    receivedAt: Date.now(),
  });
}

function subjectForChannel(kind: ChannelKind, subject: string | undefined, message: string) {
  const explicit = cleanText(subject ?? '', SUBJECT_LIMIT);
  if (explicit) return explicit;
  const firstLine = cleanText(message.split(/\r?\n/)[0] ?? '', 80);
  return `${kind === 'chat' ? 'Chat' : 'Form'}: ${firstLine || 'New conversation'}`;
}

export { appendPublicSessionMessage, publicSessionMessages } from './session-replies';
