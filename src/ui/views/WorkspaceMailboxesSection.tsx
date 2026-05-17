import { useEffect, useState } from 'react';
import { API } from '../api';
import type { WorkspaceMailbox } from '../../types/workspace';

interface WorkspaceMailboxesSectionProps {
  onSaved: (message?: string) => void;
}

export function WorkspaceMailboxesSection({ onSaved }: WorkspaceMailboxesSectionProps) {
  const [mailboxes, setMailboxes] = useState<WorkspaceMailbox[]>([]);
  const [draft, setDraft] = useState({ address: '', display_name: '', auto_reply_policy: 'safe' });
  const [canManage, setCanManage] = useState(false);

  async function load() {
    const [me, mailboxRes] = await Promise.all([API.me(), API.workspaceMailboxes()]);
    const current = me.workspaces?.find((w) => w.id === me.currentWorkspaceId);
    setCanManage(current?.role === 'owner' || current?.role === 'admin');
    setMailboxes(mailboxRes.mailboxes ?? []);
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <h2>Mailboxes</h2>
      <div className="card">
        <div className="row">
          <input disabled={!canManage} value={draft.address} placeholder="support@example.com" onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <input disabled={!canManage} value={draft.display_name} placeholder="Display name" onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
          <select disabled={!canManage} value={draft.auto_reply_policy} onChange={(e) => setDraft({ ...draft, auto_reply_policy: e.target.value })}>
            <option value="off">off</option>
            <option value="safe">safe</option>
            <option value="always">always</option>
          </select>
          <button className="primary" onClick={async () => {
            await API.createWorkspaceMailbox(draft);
            setDraft({ address: '', display_name: '', auto_reply_policy: 'safe' });
            onSaved('Mailbox added');
            await load();
          }} disabled={!canManage || !draft.address.trim()}>
            Add
          </button>
        </div>

        <div className="source-list">
          {mailboxes.map((mailbox) => (
            <div className="source-row" key={mailbox.id}>
              <div>
                <div style={{ fontWeight: 500 }}>{mailbox.address}</div>
                <div className="muted" style={{ fontSize: 12 }}>{mailbox.display_name || 'No display name'}</div>
              </div>
              <select
                value={mailbox.auto_reply_policy}
                disabled={!canManage}
                onChange={async (e) => {
                  await API.updateWorkspaceMailbox(mailbox.id, { auto_reply_policy: e.target.value });
                  onSaved('Mailbox updated');
                  await load();
                }}
              >
                <option value="off">off</option>
                <option value="safe">safe</option>
                <option value="always">always</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
