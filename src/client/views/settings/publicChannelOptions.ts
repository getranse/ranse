import type { PublicChannelKind } from '../../../types/channels';

export type DraftConfig = Record<string, string>;

// UI-level channel options. Voice fans out into one option per provider so
// operators see "Voice (ElevenLabs)" / "Voice (Twilio)" / "Voice (Gemini)"
// while the API still receives `kind: 'voice'` with the appropriate
// nested provider config.
export interface KindOption {
  value: string;
  label: string;
  channelKind: PublicChannelKind;
  voiceProvider?: 'elevenlabs' | 'twilio_realtime' | 'gemini_live';
}

export const KIND_OPTIONS: KindOption[] = [
  { value: 'chat', label: 'Chat widget', channelKind: 'chat' },
  { value: 'form', label: 'Hosted form', channelKind: 'form' },
  { value: 'slack', label: 'Slack', channelKind: 'slack' },
  { value: 'sms', label: 'SMS (Twilio)', channelKind: 'sms' },
  { value: 'discord', label: 'Discord', channelKind: 'discord' },
  { value: 'telegram', label: 'Telegram', channelKind: 'telegram' },
  { value: 'whatsapp', label: 'WhatsApp Business', channelKind: 'whatsapp' },
  { value: 'teams', label: 'Microsoft Teams', channelKind: 'teams' },
  { value: 'messenger', label: 'Facebook Messenger', channelKind: 'messenger' },
  { value: 'instagram', label: 'Instagram DM', channelKind: 'instagram' },
  { value: 'rcs', label: 'Google Business Messages (RCS)', channelKind: 'rcs' },
  { value: 'apple_business', label: 'Apple Messages for Business', channelKind: 'apple_business' },
  { value: 'webhook', label: 'Generic outbound webhook', channelKind: 'webhook' },
  { value: 'voice_elevenlabs', label: 'Voice — ElevenLabs', channelKind: 'voice', voiceProvider: 'elevenlabs' },
  { value: 'voice_twilio', label: 'Voice — Twilio + Workers AI', channelKind: 'voice', voiceProvider: 'twilio_realtime' },
  { value: 'voice_gemini', label: 'Voice — Gemini Live', channelKind: 'voice', voiceProvider: 'gemini_live' },
];

export const CONFIG_FIELDS: Record<string, { name: string; label: string; placeholder?: string }[]> = {
  chat: [],
  form: [],
  email: [],
  slack: [
    { name: 'bot_token', label: 'Bot token (xoxb-…)' },
    { name: 'signing_secret', label: 'Signing secret' },
    { name: 'bot_user_id', label: 'Bot user id (optional)', placeholder: 'U0123…' },
  ],
  sms: [
    { name: 'account_sid', label: 'Twilio Account SID (AC…)' },
    { name: 'auth_token', label: 'Twilio Auth Token' },
    { name: 'from_number', label: 'From number (E.164)', placeholder: '+15551234567' },
    { name: 'messaging_service_sid', label: 'Messaging Service SID (optional)' },
    { name: 'webhook_url', label: 'Public webhook URL', placeholder: 'https://support.example.com/public/channels/<key>/webhook' },
  ],
  discord: [
    { name: 'application_id', label: 'Application id' },
    { name: 'public_key', label: 'Public key (hex)' },
    { name: 'bot_token', label: 'Bot token' },
    { name: 'guild_id', label: 'Guild id (optional)' },
  ],
  telegram: [
    { name: 'bot_token', label: 'Bot token (BotFather)' },
    { name: 'bot_username', label: 'Bot username (optional)' },
    { name: 'webhook_url', label: 'Public webhook URL (https only)' },
  ],
  whatsapp: [
    { name: 'phone_number_id', label: 'Phone number id' },
    { name: 'app_secret', label: 'Meta app secret' },
    { name: 'access_token', label: 'Long-lived access token' },
    { name: 'verify_token', label: 'Verify token (operator-chosen)' },
  ],
  teams: [
    { name: 'app_id', label: 'Azure app id (GUID)' },
    { name: 'app_password', label: 'Azure app password' },
    { name: 'tenant_id', label: 'Tenant id (optional)' },
    { name: 'inbound_secret', label: 'Inbound webhook secret' },
  ],
  messenger: [
    { name: 'page_id', label: 'Facebook Page id' },
    { name: 'app_secret', label: 'Meta app secret' },
    { name: 'access_token', label: 'Page access token' },
    { name: 'verify_token', label: 'Verify token (operator-chosen)' },
  ],
  instagram: [
    { name: 'ig_id', label: 'Instagram Business Account id' },
    { name: 'app_secret', label: 'Meta app secret' },
    { name: 'access_token', label: 'IG access token' },
    { name: 'verify_token', label: 'Verify token (operator-chosen)' },
  ],
  rcs: [
    { name: 'agent_id', label: 'Business Messages agent id' },
    { name: 'partner_secret', label: 'Partner HMAC secret' },
    { name: 'oauth_token', label: 'Service-account OAuth bearer' },
    { name: 'webhook_url', label: 'Public webhook URL (https only)' },
  ],
  apple_business: [
    { name: 'business_id', label: 'Apple business id' },
    { name: 'msp_id', label: 'MSP id' },
    { name: 'source_id', label: 'Source id' },
    { name: 'webhook_secret', label: 'Inbound webhook secret' },
    { name: 'bearer_token', label: 'Outbound bearer token' },
  ],
  webhook: [
    { name: 'endpoint_url', label: 'Outbound endpoint URL' },
    { name: 'shared_secret', label: 'Shared HMAC secret' },
  ],
  voice_elevenlabs: [
    { name: 'agent_id', label: 'ElevenLabs Agent id' },
    { name: 'webhook_secret', label: 'Post-call webhook secret' },
    { name: 'api_key', label: 'ElevenLabs API key' },
  ],
  voice_twilio: [
    { name: 'account_sid', label: 'Twilio Account SID (AC…)' },
    { name: 'auth_token', label: 'Twilio Auth Token' },
    { name: 'phone_number', label: 'Twilio voice number (E.164)' },
    { name: 'webhook_url', label: 'Public webhook URL (https)' },
  ],
  voice_gemini: [
    { name: 'api_key', label: 'Google Generative AI API key' },
    { name: 'model', label: 'Model', placeholder: 'gemini-2.0-flash-exp' },
    { name: 'voice', label: 'Voice name', placeholder: 'Aoede' },
    { name: 'system_instruction', label: 'System instruction (optional)' },
  ],
};

export const emptyDraft = {
  kind: 'chat',
  mailbox_id: '',
  name: 'Website support',
  allowed_origins: '',
  welcome_message: '',
  require_email: true,
  sla_first_response_minutes: '',
  sla_resolution_minutes: '',
  greeting: '',
  language: 'en-US',
  config: {} as DraftConfig,
};

export type ChannelDraft = typeof emptyDraft;
