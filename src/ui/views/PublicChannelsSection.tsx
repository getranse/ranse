import { useEffect, useState } from 'react';
import { API, type PublicChannelEntry } from '../api';
import type { WorkspaceMailbox } from '../../types/workspace';
import type { PublicChannelKind } from '../../types/channels';

interface PublicChannelsSectionProps {
  onSaved: (message?: string) => void;
}

type DraftConfig = Record<string, string>;

// UI-level channel options. Voice fans out into one option per provider so
// operators see "Voice (ElevenLabs)" / "Voice (Twilio)" / "Voice (Gemini)"
// while the API still receives `kind: 'voice'` with the appropriate
// nested provider config.
interface KindOption {
  value: string;
  label: string;
  channelKind: PublicChannelKind;
  voiceProvider?: 'elevenlabs' | 'twilio_realtime' | 'gemini_live';
}

const KIND_OPTIONS: KindOption[] = [
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

const CONFIG_FIELDS: Record<string, { name: string; label: string; placeholder?: string }[]> = {
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

const emptyDraft = {
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

export function PublicChannelsSection({ onSaved }: PublicChannelsSectionProps) {
  const [channels, setChannels] = useState<PublicChannelEntry[]>([]);
  const [mailboxes, setMailboxes] = useState<WorkspaceMailbox[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [me, mailboxRes, channelRes] = await Promise.all([
      API.me(),
      API.workspaceMailboxes(),
      API.listPublicChannels(),
    ]);
    const current = me.workspaces?.find((w) => w.id === me.currentWorkspaceId);
    setCanManage(current?.role === 'owner' || current?.role === 'admin');
    const nextMailboxes = mailboxRes.mailboxes ?? [];
    setMailboxes(nextMailboxes);
    setChannels(channelRes.channels ?? []);
    setDraft((currentDraft) => ({
      ...currentDraft,
      mailbox_id: currentDraft.mailbox_id || nextMailboxes[0]?.id || '',
    }));
  }

  useEffect(() => {
    load();
  }, []);

  async function createChannel() {
    setError(null);
    const option = KIND_OPTIONS.find((opt) => opt.value === draft.kind);
    if (!option) return;
    try {
      await API.createPublicChannel({
        kind: option.channelKind,
        mailbox_id: draft.mailbox_id,
        name: draft.name,
        require_email: draft.require_email,
        allowed_origins: splitOrigins(draft.allowed_origins),
        welcome_message: draft.welcome_message || null,
        config: buildConfigPayload(option, draft),
        sla_first_response_minutes: parseMinutes(draft.sla_first_response_minutes),
        sla_resolution_minutes: parseMinutes(draft.sla_resolution_minutes),
      });
      setDraft((currentDraft) => ({ ...emptyDraft, mailbox_id: currentDraft.mailbox_id }));
      onSaved('Channel created');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    }
  }

  async function toggle(channel: PublicChannelEntry) {
    await API.updatePublicChannel(channel.id, { enabled: channel.enabled !== 1 });
    onSaved('Channel updated');
    await load();
  }

  const option = KIND_OPTIONS.find((opt) => opt.value === draft.kind);
  const configFields = CONFIG_FIELDS[draft.kind] ?? [];
  const isVoice = option?.channelKind === 'voice';

  return (
    <>
      <h2>Public channels</h2>
      <div className="card">
        <div className="row public-channel-create">
          <select
            disabled={!canManage}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value, config: {} })}
          >
            {KIND_OPTIONS.map((opt) => (
              <option value={opt.value} key={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            disabled={!canManage || mailboxes.length === 0}
            value={draft.mailbox_id}
            onChange={(e) => setDraft({ ...draft, mailbox_id: e.target.value })}
          >
            {mailboxes.map((mailbox) => (
              <option value={mailbox.id} key={mailbox.id}>
                {mailbox.address}
              </option>
            ))}
          </select>
          <input
            disabled={!canManage}
            value={draft.name}
            placeholder="Channel name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <button
            className="primary"
            disabled={!canManage || !draft.mailbox_id || !draft.name.trim()}
            onClick={createChannel}
          >
            Add
          </button>
        </div>
        {(option?.channelKind === 'chat' || option?.channelKind === 'form') && (
          <div className="row">
            <input
              disabled={!canManage}
              value={draft.allowed_origins}
              placeholder="https://example.com, https://docs.example.com"
              onChange={(e) => setDraft({ ...draft, allowed_origins: e.target.value })}
            />
            <input
              disabled={!canManage}
              value={draft.welcome_message}
              placeholder="Welcome message"
              onChange={(e) => setDraft({ ...draft, welcome_message: e.target.value })}
            />
            <label className="inline-check">
              <input
                disabled={!canManage}
                type="checkbox"
                checked={draft.require_email}
                onChange={(e) => setDraft({ ...draft, require_email: e.target.checked })}
              />
              Require email
            </label>
          </div>
        )}
        {configFields.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {configFields.map((field) => (
              <input
                key={field.name}
                disabled={!canManage}
                value={draft.config[field.name] ?? ''}
                placeholder={field.placeholder ?? field.label}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    config: { ...draft.config, [field.name]: e.target.value },
                  })
                }
              />
            ))}
          </div>
        )}
        {isVoice && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input
              disabled={!canManage}
              value={draft.greeting}
              placeholder="Greeting read on call answer"
              onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
            />
            <input
              disabled={!canManage}
              value={draft.language}
              placeholder="Language (BCP-47, e.g. en-US)"
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
            />
          </div>
        )}
        <div className="row">
          <input
            disabled={!canManage}
            type="number"
            min={1}
            value={draft.sla_first_response_minutes}
            placeholder="First response SLA (minutes)"
            onChange={(e) => setDraft({ ...draft, sla_first_response_minutes: e.target.value })}
          />
          <input
            disabled={!canManage}
            type="number"
            min={1}
            value={draft.sla_resolution_minutes}
            placeholder="Resolution SLA (minutes)"
            onChange={(e) => setDraft({ ...draft, sla_resolution_minutes: e.target.value })}
          />
        </div>
        {error && (
          <div className="muted" style={{ color: 'crimson', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div className="source-list">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              canManage={canManage}
              onToggle={() => toggle(channel)}
            />
          ))}
          {channels.length === 0 && (
            <div className="muted">No public channels configured for this workspace.</div>
          )}
        </div>
      </div>
    </>
  );
}

function ChannelRow({
  channel,
  canManage,
  onToggle,
}: {
  channel: PublicChannelEntry;
  canManage: boolean;
  onToggle: () => void;
}) {
  const summary = sharingSummary(channel);
  return (
    <div className="source-row public-channel-row">
      <div>
        <div style={{ fontWeight: 500 }}>
          {channel.name} <span className="pill">{channel.kind}</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {channel.mailbox_address} · {channel.enabled === 1 ? 'enabled' : 'disabled'}
        </div>
        {summary.embed && <code>{summary.embed}</code>}
        <div className="muted" style={{ fontSize: 12 }}>
          {summary.hint}
        </div>
      </div>
      <button disabled={!canManage} onClick={onToggle}>
        {channel.enabled === 1 ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}

function sharingSummary(channel: PublicChannelEntry): { embed: string | null; hint: string } {
  if (channel.kind === 'chat') {
    return {
      embed: `<script async src="${widgetUrl(channel)}"></script>`,
      hint: widgetUrl(channel),
    };
  }
  if (channel.kind === 'form') {
    return {
      embed: `<iframe src="${formUrl(channel)}" loading="lazy"></iframe>`,
      hint: formUrl(channel),
    };
  }
  if (channel.kind === 'voice') {
    return { embed: null, hint: `Voice webhook + WS: ${webhookUrl(channel)}` };
  }
  return { embed: null, hint: `Webhook URL: ${webhookUrl(channel)}` };
}

function buildConfigPayload(option: KindOption, draft: typeof emptyDraft): Record<string, unknown> {
  const clean = cleanConfig(draft.config);
  if (option.channelKind === 'voice' && option.voiceProvider) {
    return {
      provider: option.voiceProvider,
      [option.voiceProvider]: clean,
      greeting: draft.greeting?.trim() || undefined,
      language: draft.language?.trim() || undefined,
    };
  }
  return clean;
}

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanConfig(draft: DraftConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function parseMinutes(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function widgetUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/widget/${channel.public_key}.js`;
}

function formUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/forms/${channel.public_key}`;
}

function webhookUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/public/channels/${channel.public_key}/webhook`;
}
