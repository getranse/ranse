import type { VoiceProviderKind } from '../types/shared/channels';
import type { VoiceAgentMode, VoiceCallRole, VoiceCallStatus } from '../types/shared/voice';

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
