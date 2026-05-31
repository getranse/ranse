import type { ChannelCapabilities, PublicChannel, PublicChannelConfig, PublicConversationSession, PublicSessionMessage, ChannelIdentity, IngressResult, IngressMessage, IngressAttachment, EgressMessage, EgressAttachment, EgressResult, ChannelOutboundDispatch } from '../../interfaces/channels';
export type { ChannelCapabilities, PublicChannel, PublicChannelConfig, PublicConversationSession, PublicSessionMessage, ChannelIdentity, IngressResult, IngressMessage, IngressAttachment, EgressMessage, EgressAttachment, EgressResult, ChannelOutboundDispatch };
// Public surface channels are anything that can both receive customer messages
// and route operator replies back to the customer. Email is modelled separately
// (it pre-dates this abstraction and is rooted in `mailbox`), but everything
// else — chat widget, hosted form, Slack, SMS, Discord, Telegram, WhatsApp —
// shares this contract. Adding a new channel is one adapter file plus a
// migration-free config blob.

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

// Parsed adapter config blob per kind. Adapters narrow this themselves; this
// type just enforces that the registry returns something object-shaped.
export type ChannelConfig = Record<string, unknown>;
