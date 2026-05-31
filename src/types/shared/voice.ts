import type { VoiceCall, VoiceCallTurn, VoiceCallIngressStart, VoiceCallIngressTurn, VoiceCallIngressEnd } from '../../interfaces/voice';
export type { VoiceCall, VoiceCallTurn, VoiceCallIngressStart, VoiceCallIngressTurn, VoiceCallIngressEnd };

// Domain types for the voice channel. Voice differs from text channels in
// that the unit of work is a *call* (many turns), not a single message; we
// keep the call-level row in `voice_call` and persist every utterance as
// both a `voice_call_turn` and a `message_index` row so the text-based
// reply/procedure pipeline sees the conversation transparently.

export type VoiceCallStatus = 'ringing' | 'connected' | 'completed' | 'missed' | 'failed';

export type VoiceCallRole = 'caller' | 'agent' | 'system';

export type VoiceAgentMode = 'autonomous' | 'human' | 'mixed';

export type VoiceCallIngress = VoiceCallIngressStart | VoiceCallIngressTurn | VoiceCallIngressEnd;
