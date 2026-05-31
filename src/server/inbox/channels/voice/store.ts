import type { Env } from '../../../env';
import { ids } from '../../../../lib/ids';
import { putRaw, r2Keys } from '../../../../lib/storage';
import type {
  VoiceCall,
  VoiceCallIngressEnd,
  VoiceCallIngressStart,
  VoiceCallIngressTurn,
  VoiceCallTurn,
} from '../../../../types/shared/voice';

// DB helpers for the voice tables. Pure data ops — orchestration (ticket
// creation, identity stitching, event emission) lives in `voice/ingest.ts`.

export async function getCallByExternalId(
  env: Env,
  workspaceId: string,
  channelId: string,
  externalCallId: string,
): Promise<VoiceCall | null> {
  return env.DB.prepare(
    `SELECT * FROM voice_call
       WHERE workspace_id = ? AND channel_id = ? AND external_call_id = ?`,
  )
    .bind(workspaceId, channelId, externalCallId)
    .first<VoiceCall>();
}

export async function getCallById(
  env: Env,
  workspaceId: string,
  callId: string,
): Promise<VoiceCall | null> {
  return env.DB.prepare(`SELECT * FROM voice_call WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, callId)
    .first<VoiceCall>();
}

export async function insertCall(
  env: Env,
  args: {
    workspaceId: string;
    channelId: string;
    ticketId: string;
    customerId: string | null;
    provider: VoiceCall['provider'];
    event: VoiceCallIngressStart;
  },
): Promise<VoiceCall> {
  const now = Date.now();
  const id = ids.voiceCall();
  await env.DB.prepare(
    `INSERT INTO voice_call (
       id, workspace_id, channel_id, ticket_id, customer_id, provider,
       external_call_id, caller_number, callee_number, direction, status,
       agent_mode, started_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbound', 'ringing', 'autonomous', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      args.workspaceId,
      args.channelId,
      args.ticketId,
      args.customerId,
      args.provider,
      args.event.externalCallId,
      args.event.callerNumber,
      args.event.calleeNumber,
      args.event.startedAt,
      JSON.stringify(args.event.metadata ?? {}),
      now,
      now,
    )
    .run();
  const inserted = await env.DB.prepare(`SELECT * FROM voice_call WHERE id = ?`)
    .bind(id)
    .first<VoiceCall>();
  if (!inserted) throw new Error('voice_call_insert_failed');
  return inserted;
}

export async function markCallConnected(
  env: Env,
  callId: string,
  connectedAt: number,
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE voice_call SET status = 'connected', connected_at = ?, updated_at = ?
       WHERE id = ? AND status = 'ringing'`,
  )
    .bind(connectedAt, now, callId)
    .run();
}

export async function markCallEnded(
  env: Env,
  callId: string,
  event: VoiceCallIngressEnd,
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE voice_call
        SET status = ?, ended_at = ?, duration_ms = ?, recording_r2_key = COALESCE(?, recording_r2_key),
            transcript_r2_key = COALESCE(?, transcript_r2_key),
            summary = COALESCE(?, summary),
            error = COALESCE(?, error),
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      event.status,
      event.endedAt,
      event.durationMs ?? null,
      event.recordingR2Key ?? null,
      event.transcriptR2Key ?? null,
      event.summary ?? null,
      event.error ?? null,
      now,
      callId,
    )
    .run();
}

export async function insertTurn(
  env: Env,
  args: {
    workspaceId: string;
    callId: string;
    ticketId: string;
    messageId: string | null;
    event: VoiceCallIngressTurn;
  },
): Promise<VoiceCallTurn> {
  const id = ids.voiceTurn();
  await env.DB.prepare(
    `INSERT INTO voice_call_turn (
       id, workspace_id, call_id, ticket_id, message_id, sequence, role, text,
       audio_r2_key, duration_ms, model, confidence, interrupted,
       started_at, completed_at, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
     ON CONFLICT(call_id, sequence) DO NOTHING`,
  )
    .bind(
      id,
      args.workspaceId,
      args.callId,
      args.ticketId,
      args.messageId,
      args.event.sequence,
      args.event.role,
      args.event.text,
      args.event.audioR2Key ?? null,
      args.event.durationMs ?? null,
      args.event.model ?? null,
      args.event.confidence ?? null,
      args.event.interrupted ? 1 : 0,
      args.event.startedAt,
      args.event.completedAt,
    )
    .run();
  const inserted = await env.DB.prepare(
    `SELECT * FROM voice_call_turn WHERE call_id = ? AND sequence = ?`,
  )
    .bind(args.callId, args.event.sequence)
    .first<VoiceCallTurn>();
  if (!inserted) throw new Error('voice_turn_insert_failed');
  return inserted;
}

export async function listTurns(
  env: Env,
  workspaceId: string,
  callId: string,
): Promise<VoiceCallTurn[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM voice_call_turn WHERE workspace_id = ? AND call_id = ?
       ORDER BY sequence ASC`,
  )
    .bind(workspaceId, callId)
    .all<VoiceCallTurn>();
  return rows.results ?? [];
}

// Persists the raw provider event for replay/debugging. The payload goes to
// R2 because event bodies can be large (audio metadata, full transcripts).
export async function recordProviderEvent(
  env: Env,
  args: {
    workspaceId: string;
    channelId: string;
    callId: string | null;
    provider: string;
    eventType: string;
    rawBody: string;
  },
): Promise<void> {
  const id = ids.voiceEvent();
  const key = r2Keys.voiceProviderEvent(args.workspaceId, id);
  await putRaw(env, key, new TextEncoder().encode(args.rawBody), 'application/json');
  await env.DB.prepare(
    `INSERT INTO voice_provider_event (
       id, workspace_id, call_id, channel_id, provider, event_type,
       payload_r2_key, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      args.workspaceId,
      args.callId,
      args.channelId,
      args.provider,
      args.eventType,
      key,
      Date.now(),
    )
    .run();
}
