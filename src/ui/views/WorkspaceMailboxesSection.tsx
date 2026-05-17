import { useEffect, useState } from 'react';
import { API } from '../api';
import type { AutonomyPolicy } from '../../types/autonomy';
import {
  DEFAULT_AUTONOMY_ROLLOUT_PERCENT,
  DEFAULT_AUTONOMY_THRESHOLD,
  normalizeAutonomyPolicy,
} from '../../types/autonomy';
import type { WorkspaceMailbox } from '../../types/workspace';
import { PolicySelect, RolloutInput, ThresholdInput } from './MailboxAutonomyControls';

interface WorkspaceMailboxesSectionProps {
  onSaved: (message?: string) => void;
}

type MailboxDraft = {
  address: string;
  display_name: string;
  autonomy_policy: AutonomyPolicy;
  autonomy_threshold: number;
  autonomy_rollout_percent: number;
};

const emptyDraft: MailboxDraft = {
  address: '',
  display_name: '',
  autonomy_policy: 'draft_only',
  autonomy_threshold: DEFAULT_AUTONOMY_THRESHOLD,
  autonomy_rollout_percent: DEFAULT_AUTONOMY_ROLLOUT_PERCENT,
};

export function WorkspaceMailboxesSection({ onSaved }: WorkspaceMailboxesSectionProps) {
  const [mailboxes, setMailboxes] = useState<WorkspaceMailbox[]>([]);
  const [draft, setDraft] = useState<MailboxDraft>(emptyDraft);
  const [canManage, setCanManage] = useState(false);

  async function load() {
    const [me, mailboxRes] = await Promise.all([API.me(), API.workspaceMailboxes()]);
    const current = me.workspaces?.find((w) => w.id === me.currentWorkspaceId);
    setCanManage(current?.role === 'owner' || current?.role === 'admin');
    setMailboxes(mailboxRes.mailboxes ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function addMailbox() {
    await API.createWorkspaceMailbox(draft);
    setDraft(emptyDraft);
    onSaved('Mailbox added');
    await load();
  }

  async function updatePolicy(
    mailbox: WorkspaceMailbox,
    body: {
      autonomy_policy?: AutonomyPolicy;
      autonomy_threshold?: number;
      autonomy_rollout_percent?: number;
    },
  ) {
    await API.updateWorkspaceMailbox(mailbox.id, body);
    onSaved('Mailbox updated');
    await load();
  }

  return (
    <>
      <h2>Mailboxes</h2>
      <div className="card">
        <div className="row">
          <input
            disabled={!canManage}
            value={draft.address}
            placeholder="support@example.com"
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
          <input
            disabled={!canManage}
            value={draft.display_name}
            placeholder="Display name"
            onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
          />
          <PolicySelect
            disabled={!canManage}
            value={draft.autonomy_policy}
            onChange={(autonomy_policy) => setDraft({ ...draft, autonomy_policy })}
          />
          <ThresholdInput
            disabled={!canManage || draft.autonomy_policy !== 'auto_send_if_confident'}
            value={draft.autonomy_threshold}
            onChange={(autonomy_threshold) => setDraft({ ...draft, autonomy_threshold })}
          />
          <RolloutInput
            disabled={!canManage || draft.autonomy_policy === 'draft_only'}
            value={draft.autonomy_rollout_percent}
            onChange={(autonomy_rollout_percent) => setDraft({ ...draft, autonomy_rollout_percent })}
          />
          <button className="primary" onClick={addMailbox} disabled={!canManage || !draft.address.trim()}>
            Add
          </button>
        </div>

        <div className="source-list">
          {mailboxes.map((mailbox) => {
            const policy = normalizeAutonomyPolicy(mailbox.autonomy_policy ?? mailbox.auto_reply_policy);
            return (
              <div className="source-row" key={mailbox.id}>
                <div>
                  <div style={{ fontWeight: 500 }}>{mailbox.address}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {mailbox.display_name || 'No display name'}
                  </div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <PolicySelect
                    disabled={!canManage}
                    value={policy}
                    onChange={(autonomy_policy) => updatePolicy(mailbox, { autonomy_policy })}
                  />
                  <ThresholdInput
                    disabled={!canManage || policy !== 'auto_send_if_confident'}
                    value={mailbox.autonomy_threshold ?? DEFAULT_AUTONOMY_THRESHOLD}
                    onChange={(autonomy_threshold) => updatePolicy(mailbox, { autonomy_threshold })}
                  />
                  <RolloutInput
                    disabled={!canManage || policy === 'draft_only'}
                    value={mailbox.autonomy_rollout_percent ?? DEFAULT_AUTONOMY_ROLLOUT_PERCENT}
                    onChange={(autonomy_rollout_percent) =>
                      updatePolicy(mailbox, { autonomy_rollout_percent })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
