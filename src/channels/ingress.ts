import type { Env } from '../env';
import { audit } from '../lib/audit';
import { ids } from '../lib/ids';
import { recordOutcome } from '../lib/outcomes';
import { putRaw, r2Keys } from '../lib/storage';
import { acknowledgePlansForCustomer } from '../notifications/cascade/runner';
import { applyStopKeyword } from '../notifications/preferences';
import {
  resumeWaitingProcedureRuns,
  startTriggeredProcedureRuns,
} from '../procedures/orchestration';
import type { IngressMessage, IngressResult, PublicChannel } from '../types/channels';
import { resolveCustomerIdentity } from './identity';
import {
  appendInboundMessageRow,
  emitInboundEvents,
  externalRef,
  findOpenTicketForCustomer,
  findTicketByExternalThread,
  previewText,
  requesterAddress,
  subjectFor,
  touchChannelEvent,
} from './ingress-state';
import { tryGetAdapter } from './registry';

// Shared inbound pipeline. Every third-party adapter calls this after it
// has verified + parsed its provider payload. Behaviour:
//  - Dedup on (workspace, channel, external_id).
//  - Reuse or create a customer via channel_identity stitching.
//  - Continue an existing thread (when the provider gave us one) or pick the
//    most recent open ticket from the same channel+customer; otherwise open
//    a new ticket.
//  - Emit ticket.created / message.inbound and trigger / resume procedures.
export async function ingestInboundMessage(
  env: Env,
  channel: PublicChannel,
  message: IngressMessage,
): Promise<IngressResult | null> {
  const dedup = await env.DB.prepare(
    `SELECT id FROM message_index
       WHERE workspace_id = ? AND rfc_message_id = ?
       LIMIT 1`,
  )
    .bind(channel.workspace_id, externalRef(channel, message.externalId))
    .first<{ id: string }>();
  if (dedup) return null;

  const identity = await resolveCustomerIdentity(env, {
    workspaceId: channel.workspace_id,
    channelKind: channel.kind,
    externalId: message.from.externalId,
    displayName: message.from.displayName ?? null,
    email: message.from.email ?? null,
    phone: message.from.phone ?? null,
  });

  // STOP / UNSUBSCRIBE keywords disable the originating channel for this
  // customer before any procedure runs. The text still becomes part of the
  // ticket so operators see the opt-out as an inbound message.
  await applyStopKeyword(env, {
    workspaceId: channel.workspace_id,
    customerId: identity.customerId,
    channelKind: channel.kind,
    text: message.text,
  }).catch(() => false);

  // Any inbound on a channel with an active notification cascade marks
  // that cascade as acknowledged and stops the fallback steps.
  await acknowledgePlansForCustomer(
    env,
    channel.workspace_id,
    identity.customerId,
    channel.kind,
  ).catch(() => 0);

  const existingTicket = message.externalThreadId
    ? await findTicketByExternalThread(env, channel, message.externalThreadId)
    : await findOpenTicketForCustomer(env, channel, identity.customerId);

  const now = Date.now();
  if (existingTicket) {
    return continueExistingThread(env, channel, message, existingTicket, identity.customerId, now);
  }

  const ticketId = ids.ticket();
  const messageId = ids.message();
  const subject = subjectFor(channel.kind, message);
  const requester = requesterAddress(channel, message);
  const bodyKey = r2Keys.textBody(channel.workspace_id, ticketId, messageId);
  await putRaw(env, bodyKey, new TextEncoder().encode(message.text), 'text/plain; charset=utf-8');

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
      requester,
      message.from.displayName ?? null,
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
      requester,
      channel.mailbox_address ?? null,
      subject,
      externalRef(channel, message.externalId),
      previewText(message.text),
      bodyKey,
      message.receivedAt,
      now,
    ),
  ]);

  await emitInboundEvents(env, channel, {
    ticketId,
    messageId,
    subject,
    fromAddress: requester,
    fromName: message.from.displayName ?? null,
    text: message.text,
    isReplyToExisting: false,
  });
  await startTriggeredProcedureRuns(env, channel.workspace_id, {
    ticketId,
    trigger: { type: 'ticket_created' },
    context: {
      ticket: {
        subject,
        requester_email: requester,
        requester_name: message.from.displayName ?? null,
      },
      inbound: { message_id: messageId, body: message.text },
      channel: {
        id: channel.id,
        kind: channel.kind,
        public_key: channel.public_key,
        capabilities: tryGetAdapter(channel.kind)?.capabilities ?? null,
      },
    },
    eventKey: `ticket_created:${ticketId}`,
  }).catch((err) => console.warn('failed to start procedures from ingress', err));
  await touchChannelEvent(env, channel.id, now);
  await audit(env, {
    workspaceId: channel.workspace_id,
    ticketId,
    actorType: 'system',
    action: `channel.${channel.kind}.ticket_created`,
    payload: { channelId: channel.id, messageId, customerId: identity.customerId },
  });

  return { ticketId, messageId, customerId: identity.customerId, isNewTicket: true };
}

async function continueExistingThread(
  env: Env,
  channel: PublicChannel,
  message: IngressMessage,
  existingTicket: { id: string; subject: string; status: string },
  customerId: string,
  now: number,
): Promise<IngressResult> {
  const messageId = await appendInboundMessageRow(env, channel, existingTicket, message, now);
  await env.DB.prepare(
    `UPDATE ticket SET status = CASE WHEN status = 'spam' THEN 'spam' ELSE 'open' END,
                       last_message_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
  )
    .bind(now, now, existingTicket.id, channel.workspace_id)
    .run();
  if (['pending', 'resolved', 'closed'].includes(existingTicket.status)) {
    await recordOutcome(env, {
      workspaceId: channel.workspace_id,
      ticketId: existingTicket.id,
      kind: 'customer_followed_up',
      source: 'system',
      payload: { messageId, previousStatus: existingTicket.status, channelId: channel.id },
    });
  }
  await emitInboundEvents(env, channel, {
    ticketId: existingTicket.id,
    messageId,
    subject: existingTicket.subject,
    fromAddress: requesterAddress(channel, message),
    fromName: message.from.displayName ?? null,
    text: message.text,
    isReplyToExisting: true,
  });
  await resumeWaitingProcedureRuns(env, channel.workspace_id, {
    ticketId: existingTicket.id,
    event: 'customer_reply',
    payload: {
      messageId,
      subject: existingTicket.subject,
      from: requesterAddress(channel, message),
    },
  }).catch((err) => console.warn('failed to resume procedures from ingress', err));
  await touchChannelEvent(env, channel.id, now);
  await audit(env, {
    workspaceId: channel.workspace_id,
    ticketId: existingTicket.id,
    actorType: 'system',
    action: `channel.${channel.kind}.message_received`,
    payload: { channelId: channel.id, messageId, customerId },
  });
  return { ticketId: existingTicket.id, messageId, customerId, isNewTicket: false };
}
