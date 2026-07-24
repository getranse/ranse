import type { Env } from '../server/env';
import type { ChannelKind } from '../types/shared/channels';
import type {
  ChannelCapabilities,
  EgressMessage,
  EgressResult,
  IngressMessage,
  PublicChannel,
} from './channels';

export interface SessionState {
  env: Env;
  channel: PublicChannel;
  externalCallId: string;
  startedAt: number;
  sequence: number;
  transcriptBufferAgent: string;
  transcriptBufferCaller: string;
}

export interface StreamSession {
  env: Env;
  channel: PublicChannel;
  streamSid: string | null;
  callSid: string | null;
  startedAt: number;
  sequence: number;
  pcmBuffer: Int16Array[];
  pcmSamples: number;
  flushing: boolean;
  greetingSent: boolean;
  ended: boolean;
}

// What the adapter exposes to ingress + egress code. Adapter implementations
// hold no state — they receive `env` and the channel row each call.
export interface ChannelAdapter {
  kind: ChannelKind;
  capabilities: ChannelCapabilities;
  // Config keys that contain credentials. The channel admin layer moves
  // these out of `config_json` into `secrets_ciphertext` on persist, and
  // merges them back on read via `parseChannelConfigAsync`. Omitting means
  // "everything in config_json is non-sensitive" (chat/form/voice-shell).
  secretFields?: readonly string[];
  // Validate config_json the operator submitted before persisting. Throw with
  // a descriptive Error.message that maps to a 400 in the API layer.
  validateConfig(input: unknown): Record<string, unknown>;
  // Best-effort post-create hook (e.g. set Telegram webhook URL). Failures
  // here surface to the operator at activation time, not at request time.
  onActivate?(env: Env, channel: PublicChannel): Promise<void>;
  // Verify a provider webhook. Return null when signature/timestamp pass and
  // an Error message when they fail.
  verifyWebhook(
    env: Env,
    channel: PublicChannel,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  // Convert a verified provider payload into a normalized inbound message,
  // or return null if it's a non-message event (URL verification challenges,
  // delivery receipts, etc) that the caller should ack without ingesting.
  parseIngress(
    env: Env,
    channel: PublicChannel,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<IngressMessage | null>;
  // Provider-specific verification challenge response (Meta hub.challenge,
  // Slack url_verification). Optional — return a Response if the adapter
  // handles the request without ingest, otherwise return null.
  handleChallenge?(env: Env, channel: PublicChannel, request: Request): Promise<Response | null>;
  // Send an outbound reply through the provider.
  egress(env: Env, channel: PublicChannel, message: EgressMessage): Promise<EgressResult>;
}
