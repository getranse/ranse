import { useEffect, useState } from 'react';
import type { PublicChannelsSectionProps } from '../../../interfaces/client';
import type { WorkspaceMailbox } from '../../../types/shared/workspace';
import { API, type PublicChannelEntry } from '../../api';
import { ChannelRow } from './PublicChannelRow';
import { buildConfigPayload, parseMinutes, splitOrigins } from './publicChannelHelpers';
import { CONFIG_FIELDS, emptyDraft, KIND_OPTIONS } from './publicChannelOptions';

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
