import type { Env } from '../env';
import { ids } from '../lib/ids';
import { putRaw, r2Keys } from '../lib/storage';
import { emitEvent } from '../notifications/dispatch';
import type { IngressMessage, PublicChannel } from '../types/channels';

const SUBJECT_MAX = 180;
const PREVIEW_CHARS = 280;

// Pure DB / R2 / emit helpers split out of `ingress.ts` so the main file
// stays focused on the orchestration logic (dedup → identity → ticket →
// emit → procedures). Behaviour-level tests cover the orchestration in
// `ingress.ts`; these helpers are exercised through it.

export async function findTicketByExternalThread(
  env: Env,
  channel: PublicChannel,
  externalThreadId: string,
): Promise<{ id: string; subject: string; status: string } | null> {
  return env.DB.prepare(
    `SELECT t.id, t.subject, t.status
       FROM message_index m
       JOIN ticket t ON t.id = m.ticket_id AND t.workspace_id = m.workspace_id
      WHERE m.workspace_id = ? AND m.rfc_message_id LIKE ?
      ORDER BY m.sent_at DESC LIMIT 1`,
  )
    .bind(channel.workspace_id, `${channel.kind}:${channel.id}:thread:${externalThreadId}:%`)
    .first<{ id: string; subject: string; status: string }>();
}

export async function findOpenTicketForCustomer(
  env: Env,
  channel: PublicChannel,
  customerId: string,
): Promise<{ id: string; subject: string; status: string } | null> {
  // Channels without a thread concept (SMS, single-thread DM) continue the
  // most recent open/pending ticket from the same customer on the same
  // channel. Once resolved, a new inbound opens a fresh ticket.
  return env.DB.prepare(
    `SELECT id, subject, status FROM ticket
       WHERE workspace_id = ? AND customer_id = ? AND origin_channel_id = ?
         AND status IN ('open','pending')
       ORDER BY last_message_at DESC LIMIT 1`,
  )
    .bind(channel.workspace_id, customerId, channel.id)
    .first<{ id: string; subject: string; status: string }>();
}

export async function appendInboundMessageRow(
  env: Env,
  channel: PublicChannel,
  ticket: { id: string; subject: string },
  message: IngressMessage,
  now: number,
): Promise<string> {
  const messageId = ids.message();
  const bodyKey = r2Keys.textBody(channel.workspace_id, ticket.id, messageId);
  await putRaw(env, bodyKey, new TextEncoder().encode(message.text), 'text/plain; charset=utf-8');
  await env.DB.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, from_address, to_address, subject,
       rfc_message_id, preview, body_r2_key, sent_at, created_at
     ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      messageId,
      ticket.id,
      channel.workspace_id,
      requesterAddress(channel, message),
      channel.mailbox_address ?? null,
      ticket.subject,
      externalRef(channel, message.externalId),
      previewText(message.text),
      bodyKey,
      message.receivedAt,
      now,
    )
    .run();
  return messageId;
}

export async function emitInboundEvents(
  env: Env,
  channel: PublicChannel,
  args: {
    ticketId: string;
    messageId: string;
    subject: string;
    fromAddress: string;
    fromName: string | null;
    text: string;
    isReplyToExisting: boolean;
  },
): Promise<void> {
  if (!args.isReplyToExisting) {
    await emitEvent(env, channel.workspace_id, 'ticket.created', {
      ticketId: args.ticketId,
      subject: args.subject,
      requesterEmail: args.fromAddress,
      requesterName: args.fromName,
      preview: previewText(args.text),
      mailboxAddress: channel.mailbox_address ?? '',
      receivedAt: Date.now(),
    });
  }
  await emitEvent(env, channel.workspace_id, 'message.inbound', {
    ticketId: args.ticketId,
    messageId: args.messageId,
    subject: args.subject,
    fromAddress: args.fromAddress,
    fromName: args.fromName,
    preview: previewText(args.text),
    isReplyToExisting: args.isReplyToExisting,
    receivedAt: Date.now(),
  });
}

export async function touchChannelEvent(env: Env, channelId: string, now: number): Promise<void> {
  await env.DB.prepare(`UPDATE public_channel SET last_event_at = ? WHERE id = ?`)
    .bind(now, channelId)
    .run();
}

export function requesterAddress(channel: PublicChannel, message: IngressMessage): string {
  if (message.from.email) return message.from.email.toLowerCase();
  if (message.from.phone) return message.from.phone;
  return `${channel.kind}:${message.from.externalId}@public.ranse.local`;
}

export function subjectFor(kind: string, message: IngressMessage): string {
  const explicit = (message.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, SUBJECT_MAX);
  if (explicit) return explicit;
  const firstLine = message.text.split(/\r?\n/)[0] ?? '';
  const trimmed = firstLine.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${labelForKind(kind)}: ${trimmed || 'New conversation'}`;
}

export function externalRef(channel: PublicChannel, externalId: string): string {
  return `${channel.kind}:${channel.id}:${externalId}`;
}

export function previewText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

function labelForKind(kind: string): string {
  if (kind === 'chat') return 'Chat';
  if (kind === 'form') return 'Form';
  if (kind === 'slack') return 'Slack';
  if (kind === 'sms') return 'SMS';
  if (kind === 'discord') return 'Discord';
  if (kind === 'telegram') return 'Telegram';
  if (kind === 'whatsapp') return 'WhatsApp';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
