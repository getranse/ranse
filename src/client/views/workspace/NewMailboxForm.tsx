import { useState } from 'react';
import {
  type AutonomyPolicy,
  DEFAULT_AUTONOMY_ROLLOUT_PERCENT,
  DEFAULT_AUTONOMY_THRESHOLD,
} from '../../../types/shared/autonomy';
import { API } from '../../api';
import { PolicySelect, RolloutInput, ThresholdInput } from './MailboxAutonomyControls';

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

export function NewMailboxForm({
  canManage,
  onCreated,
}: {
  canManage: boolean;
  onCreated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<MailboxDraft>(emptyDraft);

  async function addMailbox() {
    await API.createWorkspaceMailbox(draft);
    setDraft(emptyDraft);
    await onCreated();
  }

  return (
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
      <button
        className="primary"
        onClick={addMailbox}
        disabled={!canManage || !draft.address.trim()}
      >
        Add
      </button>
    </div>
  );
}
