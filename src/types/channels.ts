// Public surface channels are anything that can both receive customer messages
// and route operator replies back to the customer. Email is modelled separately
// (it pre-dates this abstraction and is rooted in `mailbox`), but everything
// else — chat widget, hosted form, Slack, SMS, Discord, Telegram, WhatsApp —
// shares this contract. Adding a new channel is one adapter file plus a
// migration-free config blob.

import type { Env } from '../env';

// Built-in adapter kinds. Keep this union exhaustive of the in-tree adapters;
// the database column itself is free-text so contributed adapters do not need
// a schema change.
export type ChannelKind =
  | 'email'
  | 'chat'
  | 'form'
  | 'slack'
  | 'sms'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'voice'
  | 'webhook'
  | 'teams'
  | 'messenger'
  | 'instagram'
  | 'rcs'
  | 'apple_business';

// Voice is dynamic across providers: ElevenLabs Conversational AI, Twilio
// Voice + Cloudflare Workers AI relay (self-hosted), Gemini Live API.
// The provider lives in `public_channel.config_json.provider`.
export type VoiceProviderKind = 'elevenlabs' | 'twilio_realtime' | 'gemini_live';

export const VOICE_PROVIDER_KINDS: readonly VoiceProviderKind[] = [
  'elevenlabs',
  'twilio_realtime',
  'gemini_live',
] as const;

// Back-compat alias — older UI files imported this name; the canonical
// type is now `ChannelKind`.
export type PublicChannelKind = ChannelKind;

export const PUBLIC_CHANNEL_KINDS: readonly Exclude<ChannelKind, 'email'>[] = [
  'chat',
  'form',
  'slack',
  'sms',
  'discord',
  'telegram',
  'whatsapp',
  'voice',
  'webhook',
  'teams',
  'messenger',
  'instagram',
  'rcs',
  'apple_business',
] as const;

// What an adapter can do, surfaced to procedures and the operator UI so
// channel-aware logic doesn't need to branch on `kind`.
export interface ChannelCapabilities {
  // Inbound — operator can compose a reply from this channel.
  supportsInbound: boolean;
  // Outbound — adapter can deliver an operator reply to the customer.
  supportsOutbound: boolean;
  // Attachments — customer can send / operator can attach files.
  supportsAttachments: boolean;
  // Markdown rendering on the receiving end. Email/Slack yes; SMS no.
  supportsRichText: boolean;
  // Interactive buttons (Slack blocks, WhatsApp interactive messages).
  supportsButtons: boolean;
  // Out-of-band identity proof (OTP, magic link). Per-channel best practice.
  supportsOtpDelivery: boolean;
  // Typing indicators / read receipts available.
  supportsPresence: boolean;
  // Voice — the customer experiences this channel as a real-time phone call
  // or browser audio session. Procedures should keep replies short, avoid
  // links, and never include sensitive content the customer would have to
  // dictate back.
  supportsVoice: boolean;
  // Streaming — adapter ingests/emits in real time, not request-response.
  supportsStreaming: boolean;
  // Hard limits enforced by the underlying provider.
  maxMessageLength: number;
  maxAttachmentBytes: number;
}

export interface PublicChannel {
  id: string;
  workspace_id: string;
  mailbox_id: string;
  mailbox_address?: string;
  kind: ChannelKind;
  name: string;
  public_key: string;
  enabled: number;
  require_email: number;
  allowed_origins_json: string;
  welcome_message: string | null;
  config_json: string;
  secrets_ciphertext: string | null;
  secret_ciphertext: string | null;
  signing_secret: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
  default_priority: string | null;
  default_assignee_user_id: string | null;
  last_event_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PublicChannelConfig {
  key: string;
  kind: ChannelKind;
  name: string;
  require_email: boolean;
  welcome_message: string | null;
  capabilities: ChannelCapabilities;
}

export interface PublicConversationSession {
  id: string;
  workspace_id: string;
  channel_id: string;
  ticket_id: string;
  session_token_hash: string;
  requester_email: string;
  requester_name: string | null;
  visitor_id: string | null;
  origin: string | null;
  user_agent: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  closed_at: number | null;
}

export interface PublicSessionMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  preview: string | null;
  body: string | null;
  from_address: string | null;
  to_address: string | null;
  sent_at: number;
}

// Stable identity for a customer across channels. One row per (workspace,
// kind, external_id), all pointing at the same customer_id. The customer_id
// itself groups tickets in the operator UI.
export interface ChannelIdentity {
  id: string;
  workspace_id: string;
  customer_id: string;
  channel_kind: ChannelKind;
  external_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  first_seen_at: number;
  last_seen_at: number;
}

// Result of resolving a webhook payload back to a customer + thread.
export interface IngressResult {
  ticketId: string;
  messageId: string;
  customerId: string;
  isNewTicket: boolean;
}

export interface IngressMessage {
  externalId: string; // provider message id, for idempotency
  externalThreadId?: string | null; // e.g. slack thread_ts, telegram chat_id
  text: string;
  attachments?: IngressAttachment[];
  // Customer-side identifiers the adapter could resolve.
  from: {
    externalId: string;
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  subject?: string | null;
  receivedAt: number;
}

export interface IngressAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface EgressMessage {
  ticketId: string;
  messageId: string;
  externalThreadId: string | null;
  text: string;
  // Adapters that can render markdown/html use this; SMS-style adapters ignore.
  html?: string | null;
  // Pre-uploaded attachments referenced by R2 key.
  attachments?: EgressAttachment[];
  // Customer-facing display name for the from-side, when the adapter supports it.
  fromName?: string | null;
}

export interface EgressAttachment {
  r2Key: string;
  filename: string;
  contentType: string;
}

export interface EgressResult {
  externalId: string | null;
  externalThreadId: string | null;
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
  handleChallenge?(
    env: Env,
    channel: PublicChannel,
    request: Request,
  ): Promise<Response | null>;
  // Send an outbound reply through the provider.
  egress(env: Env, channel: PublicChannel, message: EgressMessage): Promise<EgressResult>;
}

// Parsed adapter config blob per kind. Adapters narrow this themselves; this
// type just enforces that the registry returns something object-shaped.
export type ChannelConfig = Record<string, unknown>;

export interface ChannelOutboundDispatch {
  id: string;
  workspace_id: string;
  ticket_id: string;
  message_id: string;
  channel_kind: ChannelKind;
  channel_id: string | null;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  last_error: string | null;
  external_id: string | null;
  created_at: number;
  updated_at: number;
}
