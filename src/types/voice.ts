import type { Env } from '../server/env';
import type { PublicChannel, VoiceProviderKind } from './channels';

// Domain types for the voice channel. Voice differs from text channels in
// that the unit of work is a *call* (many turns), not a single message; we
// keep the call-level row in `voice_call` and persist every utterance as
// both a `voice_call_turn` and a `message_index` row so the text-based
// reply/procedure pipeline sees the conversation transparently.

export type VoiceCallStatus = 'ringing' | 'connected' | 'completed' | 'missed' | 'failed';

export type VoiceCallRole = 'caller' | 'agent' | 'system';

export type VoiceAgentMode = 'autonomous' | 'human' | 'mixed';

export interface VoiceCall {
  id: string;
  workspace_id: string;
  channel_id: string;
  ticket_id: string;
  customer_id: string | null;
  provider: VoiceProviderKind;
  external_call_id: string;
  caller_number: string | null;
  callee_number: string | null;
  direction: 'inbound' | 'outbound';
  status: VoiceCallStatus;
  agent_mode: VoiceAgentMode;
  started_at: number;
  connected_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
  recording_r2_key: string | null;
  transcript_r2_key: string | null;
  summary: string | null;
  error: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

export interface VoiceCallTurn {
  id: string;
  workspace_id: string;
  call_id: string;
  ticket_id: string;
  message_id: string | null;
  sequence: number;
  role: VoiceCallRole;
  text: string | null;
  audio_r2_key: string | null;
  duration_ms: number | null;
  model: string | null;
  confidence: number | null;
  interrupted: number;
  started_at: number;
  completed_at: number | null;
  metadata_json: string;
}

// Normalized inbound that a voice provider hands back to the shared voice
// ingest path. Sources: post-call webhook (ElevenLabs), end-of-call summary
// from the streaming relay (Twilio/Gemini), or per-turn streaming callbacks.
export interface VoiceCallIngressStart {
  type: 'call_started';
  externalCallId: string;
  callerNumber: string | null;
  calleeNumber: string | null;
  startedAt: number;
  metadata?: Record<string, unknown>;
}

export interface VoiceCallIngressTurn {
  type: 'turn';
  externalCallId: string;
  sequence: number;
  role: VoiceCallRole;
  text: string;
  startedAt: number;
  completedAt: number;
  durationMs?: number;
  audioR2Key?: string | null;
  model?: string;
  confidence?: number;
  interrupted?: boolean;
}

export interface VoiceCallIngressEnd {
  type: 'call_ended';
  externalCallId: string;
  status: VoiceCallStatus;
  endedAt: number;
  durationMs?: number;
  recordingR2Key?: string | null;
  transcriptR2Key?: string | null;
  summary?: string | null;
  error?: string | null;
}

export type VoiceCallIngress = VoiceCallIngressStart | VoiceCallIngressTurn | VoiceCallIngressEnd;

// What each provider module implements. The voice ChannelAdapter dispatches
// to one of these based on `config.provider`. Streaming providers also
// expose a `handleStream` for the WebSocket upgrade path.
export interface VoiceProviderModule {
  kind: VoiceProviderKind;
  validateConfig(input: Record<string, unknown>): Record<string, unknown>;
  // Validates the provider's webhook signature/secret on a raw body. Same
  // contract as ChannelAdapter.verifyWebhook.
  verifyEvent(
    env: Env,
    channel: PublicChannel,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  // Converts a verified provider payload into one or more normalized
  // VoiceCallIngress events. Returns an empty list for non-conversational
  // events (delivery receipts, ack pings).
  parseEvent(
    env: Env,
    channel: PublicChannel,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<VoiceCallIngress[]>;
  // For providers that anchor inbound calls via TwiML / similar webhook
  // before opening the media stream, this returns the response body the
  // provider expects. Returning null means the provider does not need an
  // answer hook.
  answerCall?(env: Env, channel: PublicChannel, request: Request): Promise<Response | null>;
  // WebSocket handler for the streaming media path. Streaming providers
  // (Twilio Streams, Gemini Live) implement this; ElevenLabs returns null
  // because it owns the media path itself.
  handleStream?(env: Env, channel: PublicChannel, request: Request): Promise<Response | null>;
}
