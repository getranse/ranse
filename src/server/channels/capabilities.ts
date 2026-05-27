import type { ChannelCapabilities } from '../../types/channels';

// Hard ceilings sourced from each provider's published limits. When we
// generate replies via LLM, the procedure runner reads these and either
// trims, splits, or falls back to a different channel.

const baseFlags = {
  supportsButtons: false,
  supportsOtpDelivery: false,
  supportsPresence: false,
  supportsVoice: false,
  supportsStreaming: false,
} as const;

export const EMAIL_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true,
  supportsRichText: true,
  supportsOtpDelivery: true,
  maxMessageLength: 100_000,
  maxAttachmentBytes: 25 * 1024 * 1024,
};

export const CHAT_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: false,
  supportsRichText: false,
  supportsPresence: true,
  maxMessageLength: 5_000,
  maxAttachmentBytes: 0,
};

export const FORM_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  // Replies come back through the operator's choice (email when the form
  // collected one); the form itself does not deliver outbound.
  supportsOutbound: false,
  supportsAttachments: false,
  supportsRichText: false,
  maxMessageLength: 5_000,
  maxAttachmentBytes: 0,
};

export const SLACK_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true,
  supportsRichText: true,
  supportsButtons: true,
  supportsPresence: true,
  maxMessageLength: 40_000, // chat.postMessage soft limit; we trim at 3500 for readability
  maxAttachmentBytes: 1024 * 1024 * 1024, // Slack files API ceiling
};

export const SMS_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true, // MMS
  supportsRichText: false,
  supportsOtpDelivery: true,
  // GSM concat max — adapters split at this boundary.
  maxMessageLength: 1_600,
  maxAttachmentBytes: 5 * 1024 * 1024,
};

export const DISCORD_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true,
  supportsRichText: true,
  supportsButtons: true,
  supportsPresence: true,
  maxMessageLength: 2_000,
  maxAttachmentBytes: 25 * 1024 * 1024,
};

export const TELEGRAM_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true,
  supportsRichText: true,
  supportsButtons: true,
  supportsOtpDelivery: true,
  supportsPresence: true,
  maxMessageLength: 4_096,
  maxAttachmentBytes: 50 * 1024 * 1024,
};

export const WHATSAPP_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true,
  supportsRichText: false, // formatting only via WhatsApp markup, not HTML
  supportsButtons: true,
  supportsOtpDelivery: true,
  maxMessageLength: 4_096,
  maxAttachmentBytes: 16 * 1024 * 1024,
};

// Voice replies are short, spoken aloud, and cannot carry links. Procedures
// that branch on `supportsVoice` should keep responses < ~240 chars and
// avoid imperatives like "click here". `supportsButtons` is false because
// even providers that emit DTMF/IVR menus require special TTS prompts —
// the procedure DSL doesn't model that yet.
export const VOICE_CAPS: ChannelCapabilities = {
  ...baseFlags,
  supportsInbound: true,
  supportsOutbound: true,
  supportsAttachments: true, // call recording attaches to the ticket
  supportsRichText: false,
  supportsOtpDelivery: true, // an agent can read an OTP aloud
  supportsPresence: true,
  supportsVoice: true,
  supportsStreaming: true,
  maxMessageLength: 600, // operator replies become TTS — keep them short
  maxAttachmentBytes: 50 * 1024 * 1024, // typical inbound recording ceiling
};
