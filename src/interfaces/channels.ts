import type { ChannelKind, PublicChannelKind, VoiceProviderKind } from '../types/shared/channels';

export // Apple Messages for Business (the brand previously called Apple Business
// Chat). Once a business is approved in Apple Business Register, Apple's
// gateway POSTs inbound messages signed with `Authorization: ApplePay
// keyId=…, signature=…` and a JWS-style separator. For deployments that
// don't run a full JWS validator we accept the operator-set `webhook_secret`
// echoed as `X-Apple-Webhook-Secret` — Apple proxies the request through
// the operator's MSP, which can pin that header in their config. A future
// enhancement can replace this with full JWS verification using the
// public-key bundle Apple publishes.
//
// Outbound: POST https://mspgw.push.apple.com/v1/message with a JWT-signed
// bearer header. We let the operator paste a pre-minted bearer that they
// rotate out-of-band; sign-on-demand JWTs are a future enhancement.

interface AppleBusinessConfig {
  business_id: string;
  msp_id: string;
  source_id: string;
  webhook_secret: string;
  bearer_token: string;
  [k: string]: unknown;
}

export interface AppleBusinessEvent {
  type?: 'text' | string;
  id?: string;
  sourceId?: string;
  destinationId?: string;
  intent?: string;
  locale?: string;
  body?: { body?: string; text?: string };
  message?: { body?: string; text?: string };
}

export // Discord adapter using the Interactions Endpoint (HTTPS receiver, not
// gateway). Signature verification is Ed25519 over (timestamp || body) using
// the application's public key. The operator pastes the public key + bot
// token in channel config and points Discord's Interactions URL at
// /public/channels/:public_key/webhook.

interface DiscordConfig {
  application_id: string;
  public_key: string; // hex-encoded Ed25519 public key
  bot_token: string;
  // The bot is added to one guild that hosts the support intake channel;
  // ingress treats any DM or guild message addressed to the bot as a ticket.
  guild_id?: string | null;
  [k: string]: unknown;
}

export interface DiscordPayload {
  id?: string;
  type: number;
  channel_id?: string;
  member?: { user?: { id: string; username?: string; global_name?: string } };
  user?: { id: string; username?: string; global_name?: string };
  data?: { name?: string; options?: { name: string; value: unknown }[] };
}

export // Instagram DM via Meta Graph (Instagram Messaging API). The webhook shape
// mirrors Messenger; the differences:
//   - the `object` field in the envelope is 'instagram'
//   - the IDs in `sender.id` are Instagram-Scoped IDs, not Page-Scoped IDs
//   - outbound goes to the IG-connected Facebook Page, identified by
//     ig_id resolved at config time
//
// The operator links an Instagram Business Account to a Facebook Page and
// gives us the IG Business Account id; we use that as `ig_id`.

interface InstagramConfig extends MetaSharedConfig {
  ig_id: string;
}

export interface InstagramWebhook {
  object?: string;
  entry?: {
    id: string;
    messaging?: {
      sender?: { id: string };
      recipient?: { id: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }[];
  }[];
}

export // Facebook Messenger Platform via Meta Graph. Per-Page access token + the
// app-level secret/verify_token. Outbound: POST /me/messages on the Page.

interface MessengerConfig extends MetaSharedConfig {
  page_id: string;
}

export interface MessengerWebhook {
  object?: string;
  entry?: {
    id: string;
    messaging?: {
      sender?: { id: string };
      recipient?: { id: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }[];
  }[];
}

// Shared building blocks for Meta Graph webhooks (WhatsApp, Messenger,
// Instagram). All three speak the same envelope:
//   entry: [{ id, time, changes: [{ field, value }], messaging: [{...}] }]
// with X-Hub-Signature-256 as the only auth and a GET `hub.challenge`
// verification on subscription. The differences come down to which field
// inside `value` / `messaging` carries the inbound text.

export interface MetaSharedConfig {
  app_secret: string;
  access_token: string;
  verify_token: string;
  graph_version?: string;
  [k: string]: unknown;
}

export // Google Business Messages (the operator-facing RCS Business Messaging
// surface). Partners register a brand + agent through the Business
// Communications API; webhooks land at /public/channels/<key>/webhook with
// the operator-set `client_token` echoed in the body and signed via HMAC
// using `partner_secret`.
//
// Outbound: POST /v1/conversations/{conversationId}/messages with a bearer
// service-account token. To keep this dependency-free we let the operator
// paste a pre-minted bearer token they refresh out-of-band; a future
// enhancement can sign JWTs server-side.

interface RcsConfig {
  agent_id: string;
  partner_secret: string; // signs inbound webhook bodies
  oauth_token: string; // bearer for outbound /messages calls
  webhook_url: string;
  [k: string]: unknown;
}

export interface RcsEvent {
  conversationId: string;
  message?: { messageId?: string; text?: string };
  sendTime?: string;
  context?: { userInfo?: { displayName?: string; userDeviceLocale?: string } };
}

export // Slack adapter — Events API. Operator installs a classic / granular bot,
// pastes signing secret + bot token + bot user id in the channel config.
// Webhook URL: /public/channels/:public_key/webhook
//
// Inbound: app_mention + message.im events become tickets / replies, with
// thread_ts (or channel id for DMs) used as the external thread so threaded
// replies land in the same ticket.
//
// Outbound: chat.postMessage with thread_ts when present. Bot token is the
// only outbound credential we need.

interface SlackConfig {
  bot_token: string;
  signing_secret: string;
  bot_user_id?: string | null;
  app_id?: string | null;
  team_id?: string | null;
  [k: string]: unknown;
}

export interface SlackEnvelope {
  type: string;
  team_id?: string;
  event?: SlackEvent;
}

export interface SlackEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  event_ts?: string;
}

export // SMS — modelled on the Twilio Messages API webhook shape. The provider
// field lets us slot in Vonage/Plivo later without changing the message
// pipeline: parsing is the only provider-specific bit.
//
// Inbound: Twilio posts form-encoded — From, To, Body, MessageSid.
// Signature: HMAC-SHA1 over (url || sorted POST params), base64-encoded,
// in X-Twilio-Signature.
// Outbound: POST {Body, From|MessagingServiceSid, To} to /Messages.json.

interface SmsConfig {
  provider: 'twilio';
  account_sid: string;
  auth_token: string;
  from_number?: string | null;
  messaging_service_sid?: string | null;
  webhook_url: string; // absolute URL Twilio is configured to post to
  [k: string]: unknown;
}

export // Microsoft Teams via the Bot Framework. Inbound activities POST to our
// webhook URL with an OAuth Bearer JWT from Azure AD; we verify by
// exchanging the bot credentials for a token and matching the audience.
//
// For a self-hosted deployment we don't run a full JWT validator (RS256
// against a JWKS endpoint) — instead we require the operator-issued
// `inbound_secret` to be present on each activity in the `serviceUrl`
// fragment that Teams echoes back via the `channelData.tenant.id` path.
// Operators who need full JWT validation should put a reverse proxy in
// front that does it; this adapter is correct against the Bot Framework
// payload shape and ready for that path to be filled in.
//
// Outbound: POST to {serviceUrl}/v3/conversations/{conversationId}/activities
// with an Azure-issued bearer token fetched via client credentials grant.

interface TeamsConfig {
  app_id: string;
  app_password: string;
  tenant_id?: string | null;
  inbound_secret: string;
  [k: string]: unknown;
}

export interface BotActivity {
  type?: string;
  id?: string;
  timestamp?: string;
  text?: string;
  serviceUrl?: string;
  conversation?: { id?: string };
  from?: { id?: string; name?: string; aadObjectId?: string };
  channelData?: { team?: { name?: string }; tenant?: { id?: string } };
}

export // Telegram Bot API adapter. Simplest of all the third-party adapters:
//   - operator pastes the bot token (BotFather output) into channel config
//   - onActivate calls setWebhook on Telegram with a secret token
//   - ingress verifies the secret token via header
//   - egress is a single sendMessage call
//
// Threading: Telegram chats are 1:1 per user (DM) or per-group. We use
// chat_id as the external thread, so all messages from one chat continue
// the same ticket until it's resolved.

interface TelegramConfig {
  bot_token: string; // "12345:ABCDEF..."
  bot_username?: string | null;
  secret_token: string;
  webhook_url: string;
  [k: string]: unknown;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  chat: { id: number; type?: string };
  from: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
}

export // Generic outbound webhook adapter. The escape hatch that lets a customer
// plug *any* messaging system into Ranse without writing a new adapter:
//
//   - Operator configures: endpoint_url (where Ranse posts outbound
//     messages) + shared_secret (HMAC-signs both inbound and outbound).
//   - Inbound (their system → Ranse): POST /public/channels/<key>/webhook
//     with body `{ external_id, external_thread_id, text, from: { external_id,
//     display_name?, email?, phone? }, subject?, received_at? }`.
//     Signature header: `X-Ranse-Signature: sha256=<hex>`.
//   - Outbound (Ranse → their system): POST endpoint_url with body
//     `{ kind: 'message', ticket: {...}, message: { id, text, html, attachments[] },
//     customer: {...} }` and the same signature header. Their endpoint
//     should respond 2xx; non-2xx triggers the retry queue.

interface WebhookConfig {
  endpoint_url: string;
  shared_secret: string;
  custom_headers_json?: string;
  [k: string]: unknown;
}

export interface WebhookInboundPayload {
  external_id: string;
  external_thread_id?: string | null;
  text: string;
  subject?: string | null;
  received_at?: number;
  from: {
    external_id: string;
    display_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
}

export // WhatsApp Business Cloud API (Meta). The operator needs:
//   - phone_number_id      — the WABA phone number id (Meta Business Suite)
//   - app_secret           — Meta app secret, used to verify X-Hub-Signature-256
//   - access_token         — system user / long-lived token for /messages
//   - verify_token         — operator-chosen, used during webhook URL setup
//
// Webhooks: a single Meta App webhook routes events for many WABAs. The
// adapter compares the entry.changes[].value.metadata.phone_number_id to
// the channel's own phone_number_id to discard events meant for siblings.

interface WhatsappConfig {
  phone_number_id: string;
  app_secret: string;
  access_token: string;
  verify_token: string;
  graph_version?: string;
  [k: string]: unknown;
}

export interface WhatsappWebhook {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: WhatsappMessage[];
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
      };
    }[];
  }[];
}

export interface WhatsappMessage {
  id?: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

// Owner/admin-facing channel CRUD. The chat/form session helpers live in
// `sessions.ts`; ingress + egress live in `ingress.ts` / `egress.ts`.

export interface CreatePublicChannelInput {
  kind: ChannelKind;
  mailboxId: string;
  name: string;
  enabled?: boolean;
  requireEmail?: boolean;
  allowedOrigins?: string[];
  welcomeMessage?: string | null;
  config?: Record<string, unknown>;
  slaFirstResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  defaultPriority?: string | null;
  defaultAssigneeUserId?: string | null;
}

export interface UpdatePublicChannelInput {
  name?: string;
  enabled?: boolean;
  requireEmail?: boolean;
  allowedOrigins?: string[];
  welcomeMessage?: string | null;
  config?: Record<string, unknown>;
  slaFirstResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  defaultPriority?: string | null;
  defaultAssigneeUserId?: string | null;
}

// Outbound dispatch — called by the reply pipeline (or any code that needs
// to deliver a message to a customer) after the outbound message_index row
// has already been persisted. The dispatcher resolves the ticket's origin
// channel, looks up the adapter, calls egress, and records the result in
// `channel_outbound_dispatch` for retries + audit.

export interface DispatchInput {
  workspaceId: string;
  ticketId: string;
  messageId: string;
  text: string;
  html?: string | null;
  fromName?: string | null;
  attachments?: EgressAttachment[];
  // When set, forces a specific channel; otherwise uses the ticket's origin.
  // Used by procedures that explicitly pick an SMS for OTP delivery.
  overrideChannelKind?: ChannelKind;
  overrideChannelId?: string;
}

export interface DispatchOutcome {
  status: 'delivered' | 'failed' | 'skipped';
  channelKind: ChannelKind;
  channelId: string | null;
  externalId: string | null;
  error?: string;
}

// Identity stitching. Adapters know who the customer is on *their* surface
// (slack user id, phone number, telegram chat id, email). We map that
// external id to a stable `customer_id` so an operator sees one history per
// person, not one history per channel.
//
// Stitching rules — applied in order; the first match wins:
//   1. (workspace, channel_kind, external_id) already known → reuse customer.
//   2. The inbound payload carries an email that matches another identity's
//      email or another customer's primary_email → reuse that customer.
//   3. Same as #2 but for phone.
//   4. No match → create a fresh customer row.
//
// Stitching is conservative on purpose — false merges across people are
// worse than false splits. Operators can manually merge in the UI later.

export interface IdentityLookup {
  workspaceId: string;
  channelKind: ChannelKind;
  externalId: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export // The single ChannelAdapter for kind='voice'. It's a router: every method
// looks up the configured provider and delegates. New providers can plug
// in at `voice/providers/*` without touching the adapter.

interface VoiceChannelConfig {
  provider: VoiceProviderKind;
  // Per-provider configs live nested under the same JSON blob.
  elevenlabs?: Record<string, unknown>;
  twilio_realtime?: Record<string, unknown>;
  gemini_live?: Record<string, unknown>;
  // Shared knobs:
  agent_mode?: 'autonomous' | 'human' | 'mixed';
  greeting?: string;
  language?: string; // BCP-47, default 'en-US'
  voice?: string; // provider-specific voice id
  [k: string]: unknown;
}

export // ElevenLabs Conversational AI:
//   - Operator creates an Agent in ElevenLabs dashboard, points a phone
//     number at it, and configures a post-call webhook to our endpoint.
//   - We persist transcripts, recording (downloaded from agent_call.audio_url
//     into R2), and tool-call results.
//
// Webhook signature: ElevenLabs sends `ElevenLabs-Signature: t=<ts>,v0=<sig>`
// where v0 = hex HMAC-SHA256(`${ts}.${rawBody}`, agent_secret).

interface ElevenLabsConfig {
  agent_id: string;
  webhook_secret: string;
  api_key: string;
  // Default voice / language overrides come from the channel-level config.
  [k: string]: unknown;
}

export interface ElevenLabsWebhookPayload {
  type: string;
  event_timestamp?: number;
  data?: ElevenLabsConversationData;
}

export interface ElevenLabsConversationData {
  conversation_id: string;
  agent_id: string;
  status: string;
  transcript?: ElevenLabsUtterance[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: {
      external_number?: string;
      agent_number?: string;
      call_sid?: string;
      direction?: string;
    };
    audio_url?: string;
    summary?: string;
  };
  analysis?: { transcript_summary?: string; call_successful?: string };
}

export interface ElevenLabsUtterance {
  role: 'agent' | 'user' | 'system';
  message?: string;
  time_in_call_secs?: number;
  conversation_turn_metrics?: { metrics?: { latency_ms?: number } };
  llm_override?: { model?: string };
}

export // Gemini Live API:
//   - Native bidirectional streaming. We relay a WebSocket from the
//     customer's browser (or a Twilio media stream) into Google's
//     `BidiGenerateContent` WebSocket.
//   - The browser path is the primary intended UX — operators paste a
//     <script src="/widget/<key>.js"> on their support page that includes
//     a "Call us" button, and the customer's browser microphone connects
//     directly to /public/channels/<key>/webhook (WebSocket upgrade).
//   - Gemini emits per-turn transcripts inline; the relay persists them
//     via the shared voice ingest path.
//
// Reference: https://ai.google.dev/api/multimodal-live

interface GeminiLiveConfig {
  api_key: string;
  model: string; // e.g. 'gemini-2.0-flash-exp'
  // Customer-facing first-utterance prompt; defaults to the channel greeting.
  system_instruction?: string;
  voice?: string; // 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede' | ...
  [k: string]: unknown;
}

export // Twilio Voice + Cloudflare Workers AI:
//   - Twilio's number webhook posts to /public/channels/<key>/webhook?answer=1
//     and we respond with TwiML that opens a <Stream> WebSocket to the same
//     channel's /webhook URL (upgrade requested by Twilio).
//   - The Worker WebSocket handler bridges μ-law audio from Twilio to
//     Whisper (Workers AI) for STT, runs the LLM reply, TTS via Workers AI,
//     and streams μ-law back.
//   - Twilio's optional post-call status callback (StatusCallbackEvent=completed)
//     hits the same /webhook URL as a normal POST; we parse it as call_ended.
//   - All turn-level persistence happens during the stream; the post-call
//     event mainly finalizes status/duration/recording.

interface TwilioRealtimeConfig {
  account_sid: string;
  auth_token: string;
  phone_number: string;
  // Public URL of the channel webhook — Twilio needs the absolute origin
  // to call back into us. The channel's `webhook_url` value is stored once
  // at create-time and re-used for the TwiML response.
  webhook_url: string;
  // Optional Cloudflare AI Gateway override; defaults to the workspace's
  // gateway configuration.
  ai_gateway?: string | null;
  [k: string]: unknown;
}

export interface ClientFrame {
  type: 'audio' | 'text' | 'end';
  data?: string;
  text?: string;
}

export interface ServerFrame {
  serverContent?: {
    modelTurn?: {
      parts?: { text?: string; inlineData?: { mimeType?: string; data: string } }[];
    };
    turnComplete?: boolean;
  };
}

// Single transcribe → think → speak loop for one customer utterance.
// Called by the streaming relay every time it has buffered enough audio
// to be worth transcribing. Persists the turn (both caller + agent reply)
// through the shared voice ingest path.
export interface TurnInput {
  callSid: string;
  sequence: number;
  pcm: Int16Array;
  sampleRate: number;
  language: string;
}

export interface TurnResult {
  transcript: string;
  reply: string | null;
}

export interface TwilioFrame {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  start?: {
    streamSid?: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
  media?: { payload?: string };
}

export interface PublicChannelInput {
  kind: PublicChannelKind;
  mailbox_id: string;
  name: string;
  enabled?: boolean;
  require_email?: boolean;
  allowed_origins?: string[];
  welcome_message?: string | null;
  config?: Record<string, unknown>;
  sla_first_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
  default_priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
  default_assignee_user_id?: string | null;
}

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
