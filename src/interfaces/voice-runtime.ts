import type { Env } from '../server/env';
import type { PublicChannel, VoiceProviderKind } from '../types/shared/channels';
import type { VoiceCallIngress } from '../types/shared/voice';

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
