import type { Env } from '../../../env';
import { audit } from '../../../actions/audit';
import { ids as idHelpers, ids } from '../../../../lib/ids';
import { putRaw, r2Keys } from '../../../../lib/storage';
import { emitEvent } from '../../notifications/dispatch';
import {
  resumeWaitingProcedureRuns,
  startTriggeredProcedureRuns,
} from '../../../automation/procedures/orchestration';
import type { PublicChannel } from '../../../../types/shared/channels';
import type {
  VoiceCall,
  VoiceCallIngress,
  VoiceCallIngressEnd,
  VoiceCallIngressStart,
  VoiceCallIngressTurn,
} from '../../../../types/shared/voice';
import { resolveCustomerIdentity } from '../identity';
import { tryGetAdapter } from '../registry';
import {
  getCallByExternalId,
  insertCall,
  insertTurn,
  markCallConnected,
  markCallEnded,
} from './store';

import { PREVIEW_CHARS } from '../../../../config/channels';

// Orchestrates persistence of voice events from any provider into our
// uniform ticket/customer/message model. Providers normalize wire formats
// into `VoiceCallIngress[]`; this module is the single write path.

export async function applyVoiceEvents(
  env: Env,
  channel: PublicChannel,
  provider: VoiceCall['provider'],
  events: VoiceCallIngress[],
): Promise<void> {
  for (const event of events) {
    if (event.type === 'call_started') {
      await handleCallStarted(env, channel, provider, event);
    } else if (event.type === 'turn') {
      await handleTurn(env, channel, event);
    } else {
      await handleCallEnded(env, channel, event);
    }
  }
}

async function handleCallStarted(
  env: Env,
  channel: PublicChannel,
  provider: VoiceCall['provider'],
  event: VoiceCallIngressStart,
): Promise<void> {
  const existing = await getCallByExternalId(
    env,
    channel.workspace_id,
    channel.id,
    event.externalCallId,
  );
  if (existing) return;

  const phone = event.callerNumber ?? null;
  const identity = await resolveCustomerIdentity(env, {
    workspaceId: channel.workspace_id,
    channelKind: 'voice',
    externalId: event.callerNumber ?? event.externalCallId,
    displayName: phone,
    email: null,
    phone,
  });

  const now = Date.now();
  const ticketId = ids.ticket();
  const subject = phone ? `Voice call from ${phone}` : 'Voice call';
  const requester = phone ?? `voice:${event.externalCallId}@public.ranse.local`;

  await env.DB.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, requester_email,
       requester_name, last_message_at, thread_token, customer_id,
       origin_channel_kind, origin_channel_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 'voice', ?, ?, ?)`,
  )
    .bind(
      ticketId,
      channel.workspace_id,
      channel.mailbox_id,
      subject,
      channel.default_priority ?? 'normal',
      requester,
      phone,
      event.startedAt,
      ids.ticket().slice(4),
      identity.customerId,
      channel.id,
      now,
      now,
    )
    .run();

  const call = await insertCall(env, {
    workspaceId: channel.workspace_id,
    channelId: channel.id,
    ticketId,
    customerId: identity.customerId,
    provider,
    event,
  });

  await emitEvent(env, channel.workspace_id, 'ticket.created', {
    ticketId,
    subject,
    requesterEmail: requester,
    requesterName: phone,
    preview: subject,
    mailboxAddress: channel.mailbox_address ?? '',
    receivedAt: event.startedAt,
  });

  await startTriggeredProcedureRuns(env, channel.workspace_id, {
    ticketId,
    trigger: { type: 'ticket_created' },
    context: {
      ticket: { subject, requester_email: requester, requester_name: phone },
      inbound: { message_id: null, body: '' },
      channel: {
        id: channel.id,
        kind: channel.kind,
        public_key: channel.public_key,
        capabilities: tryGetAdapter(channel.kind)?.capabilities ?? null,
      },
      voice: {
        call_id: call.id,
        provider,
        caller_number: phone,
        agent_mode: call.agent_mode,
      },
    },
    eventKey: `ticket_created:${ticketId}`,
  }).catch((err) => console.warn('failed to start voice procedures', err));

  await audit(env, {
    workspaceId: channel.workspace_id,
    ticketId,
    actorType: 'system',
    action: 'channel.voice.call_started',
    payload: { callId: call.id, provider, externalCallId: event.externalCallId },
  });
}

async function handleTurn(
  env: Env,
  channel: PublicChannel,
  event: VoiceCallIngressTurn,
): Promise<void> {
  const call = await getCallByExternalId(
    env,
    channel.workspace_id,
    channel.id,
    event.externalCallId,
  );
  if (!call) {
    // Turn arriving without a known call (rare; usually means the start
    // webhook was lost). Open a stub ticket so the audio doesn't vanish.
    await applyVoiceEvents(env, channel, 'elevenlabs', [
      {
        type: 'call_started',
        externalCallId: event.externalCallId,
        callerNumber: null,
        calleeNumber: null,
        startedAt: event.startedAt,
      },
    ]);
    return handleTurn(env, channel, event);
  }
  if (call.status === 'ringing') {
    await markCallConnected(env, call.id, event.startedAt);
  }
  const messageId = await persistTurnMessage(env, channel, call, event);
  await insertTurn(env, {
    workspaceId: channel.workspace_id,
    callId: call.id,
    ticketId: call.ticket_id,
    messageId,
    event,
  });
  if (event.role === 'caller') {
    await emitEvent(env, channel.workspace_id, 'message.inbound', {
      ticketId: call.ticket_id,
      messageId: messageId ?? '',
      subject: call.summary ?? `Voice call from ${call.caller_number ?? 'unknown'}`,
      fromAddress: call.caller_number ?? `voice:${call.external_call_id}@public.ranse.local`,
      fromName: call.caller_number,
      preview: previewText(event.text),
      isReplyToExisting: true,
      receivedAt: event.startedAt,
    });
    await resumeWaitingProcedureRuns(env, channel.workspace_id, {
      ticketId: call.ticket_id,
      event: 'customer_reply',
      payload: { messageId, text: event.text, voice_call_id: call.id },
    }).catch((err) => console.warn('failed to resume voice procedures', err));
  }
}

async function handleCallEnded(
  env: Env,
  channel: PublicChannel,
  event: VoiceCallIngressEnd,
): Promise<void> {
  const call = await getCallByExternalId(
    env,
    channel.workspace_id,
    channel.id,
    event.externalCallId,
  );
  if (!call) return;
  await markCallEnded(env, call.id, event);
  // Final ticket subject upgrade once we have the summary.
  if (event.summary) {
    const now = Date.now();
    await env.DB.prepare(
      `UPDATE ticket SET subject = ?, last_message_at = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
    )
      .bind(event.summary.slice(0, 180), event.endedAt, now, call.ticket_id, channel.workspace_id)
      .run();
  }
  await audit(env, {
    workspaceId: channel.workspace_id,
    ticketId: call.ticket_id,
    actorType: 'system',
    action: 'channel.voice.call_ended',
    payload: {
      callId: call.id,
      status: event.status,
      durationMs: event.durationMs ?? null,
    },
  });
}

async function persistTurnMessage(
  env: Env,
  channel: PublicChannel,
  call: VoiceCall,
  event: VoiceCallIngressTurn,
): Promise<string> {
  const messageId = idHelpers.message();
  const direction = event.role === 'caller' ? 'inbound' : 'outbound';
  const bodyKey = r2Keys.textBody(channel.workspace_id, call.ticket_id, messageId);
  await putRaw(env, bodyKey, new TextEncoder().encode(event.text), 'text/plain; charset=utf-8');
  const rfcMessageId = `voice:${channel.id}:thread:${call.external_call_id}:${event.sequence}`;
  const fromAddress =
    event.role === 'caller'
      ? (call.caller_number ?? `voice:${call.external_call_id}@public.ranse.local`)
      : (call.callee_number ?? channel.mailbox_address ?? '');
  const toAddress =
    event.role === 'caller'
      ? (call.callee_number ?? channel.mailbox_address ?? '')
      : (call.caller_number ?? '');
  await env.DB.prepare(
    `INSERT INTO message_index (
       id, ticket_id, workspace_id, direction, from_address, to_address, subject,
       rfc_message_id, preview, body_r2_key, has_attachments, sent_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      messageId,
      call.ticket_id,
      channel.workspace_id,
      direction,
      fromAddress,
      toAddress,
      `Voice turn ${event.sequence}`,
      rfcMessageId,
      previewText(event.text),
      bodyKey,
      event.audioR2Key ? 1 : 0,
      event.startedAt,
      Date.now(),
    )
    .run();
  return messageId;
}

function previewText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}
