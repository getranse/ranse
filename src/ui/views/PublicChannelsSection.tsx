import { useEffect, useState } from 'react';
import { API, type PublicChannelEntry } from '../api';
import type { WorkspaceMailbox } from '../../types/workspace';
import type { PublicChannelKind } from '../../types/channels';

interface PublicChannelsSectionProps {
  onSaved: (message?: string) => void;
}

const emptyDraft = {
  kind: 'chat' as PublicChannelKind,
  mailbox_id: '',
  name: 'Website support',
  allowed_origins: '',
  welcome_message: '',
  require_email: true,
};

export function PublicChannelsSection({ onSaved }: PublicChannelsSectionProps) {
  const [channels, setChannels] = useState<PublicChannelEntry[]>([]);
  const [mailboxes, setMailboxes] = useState<WorkspaceMailbox[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [canManage, setCanManage] = useState(false);

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
    await API.createPublicChannel({
      kind: draft.kind,
      mailbox_id: draft.mailbox_id,
      name: draft.name,
      require_email: draft.require_email,
      allowed_origins: splitOrigins(draft.allowed_origins),
      welcome_message: draft.welcome_message || null,
    });
    setDraft((currentDraft) => ({ ...emptyDraft, mailbox_id: currentDraft.mailbox_id }));
    onSaved('Channel created');
    await load();
  }

  async function toggle(channel: PublicChannelEntry) {
    await API.updatePublicChannel(channel.id, { enabled: channel.enabled !== 1 });
    onSaved('Channel updated');
    await load();
  }

  return (
    <>
      <h2>Public channels</h2>
      <div className="card">
        <div className="row public-channel-create">
          <select
            disabled={!canManage}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as PublicChannelKind })}
          >
            <option value="chat">Chat widget</option>
            <option value="form">Hosted form</option>
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

        <div className="source-list">
          {channels.map((channel) => (
            <div className="source-row public-channel-row" key={channel.id}>
              <div>
                <div style={{ fontWeight: 500 }}>
                  {channel.name} <span className="pill">{channel.kind}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {channel.mailbox_address} · {channel.enabled === 1 ? 'enabled' : 'disabled'}
                </div>
                <code>{embedCode(channel)}</code>
                <div className="muted" style={{ fontSize: 12 }}>
                  {channel.kind === 'form' ? formUrl(channel) : widgetUrl(channel)}
                </div>
              </div>
              <button disabled={!canManage} onClick={() => toggle(channel)}>
                {channel.enabled === 1 ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
          {channels.length === 0 && (
            <div className="muted">No public channels configured for this workspace.</div>
          )}
        </div>
      </div>
    </>
  );
}

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function widgetUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/widget/${channel.public_key}.js`;
}

function formUrl(channel: PublicChannelEntry): string {
  return `${window.location.origin}/forms/${channel.public_key}`;
}

function embedCode(channel: PublicChannelEntry): string {
  return channel.kind === 'chat'
    ? `<script async src="${widgetUrl(channel)}"></script>`
    : `<iframe src="${formUrl(channel)}" loading="lazy"></iframe>`;
}
