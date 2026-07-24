import { useEffect, useState } from 'react';
import type { WorkspaceMailboxesSectionProps } from '../../../interfaces/client';
import type { Team } from '../../../interfaces/teams';
import type { AutonomyPolicy } from '../../../types/shared/autonomy';
import {
  DEFAULT_AUTONOMY_ROLLOUT_PERCENT,
  DEFAULT_AUTONOMY_THRESHOLD,
  normalizeAutonomyPolicy,
} from '../../../types/shared/autonomy';
import type { WorkspaceMailbox } from '../../../types/shared/workspaces';
import { API } from '../../api';
import { PolicySelect, RolloutInput, TeamSelect, ThresholdInput } from './MailboxAutonomyControls';
import { NewMailboxForm } from './NewMailboxForm';

export function WorkspaceMailboxesSection({ onSaved }: WorkspaceMailboxesSectionProps) {
  const [mailboxes, setMailboxes] = useState<WorkspaceMailbox[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [canManage, setCanManage] = useState(false);

  async function load() {
    const [me, mailboxRes, teamRes] = await Promise.all([
      API.me(),
      API.workspaceMailboxes(),
      API.teams(),
    ]);
    const current = me.workspaces?.find((w) => w.id === me.currentWorkspaceId);
    setCanManage(current?.role === 'owner' || current?.role === 'admin');
    setMailboxes(mailboxRes.mailboxes ?? []);
    setTeams(teamRes.teams ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function updatePolicy(
    mailbox: WorkspaceMailbox,
    body: {
      autonomy_policy?: AutonomyPolicy;
      autonomy_threshold?: number;
      autonomy_rollout_percent?: number;
      default_team_id?: string | null;
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
        <NewMailboxForm
          canManage={canManage}
          onCreated={async () => {
            onSaved('Mailbox added');
            await load();
          }}
        />

        <div className="source-list">
          {mailboxes.map((mailbox) => {
            const policy = normalizeAutonomyPolicy(
              mailbox.autonomy_policy ?? mailbox.auto_reply_policy,
            );
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
                  <TeamSelect
                    disabled={!canManage}
                    value={mailbox.default_team_id}
                    teams={teams}
                    onChange={(default_team_id) => updatePolicy(mailbox, { default_team_id })}
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
