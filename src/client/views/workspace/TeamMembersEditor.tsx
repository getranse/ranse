import { useCallback, useEffect, useState } from 'react';
import type { TeamMemberRow } from '../../../interfaces/teams';
import type { WorkspaceMember } from '../../../types/shared/workspaces';
import { API } from '../../api';
import { toast } from '../../components/common/toast';

export function TeamMembersEditor({
  teamId,
  workspaceMembers,
  onChanged,
  onDeleted,
}: {
  teamId: string;
  workspaceMembers: WorkspaceMember[];
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [candidate, setCandidate] = useState('');

  const load = useCallback(async () => {
    const res = await API.teamMembers(teamId);
    setMembers(res.members ?? []);
  }, [teamId]);

  useEffect(() => {
    load().catch(() => toast.error("Couldn't load team members."));
  }, [load]);

  const inTeam = new Set(members.map((m) => m.user_id));
  const addable = workspaceMembers.filter((m) => !inTeam.has(m.user_id));

  async function add() {
    if (!candidate) return;
    await API.addTeamMember(teamId, candidate);
    setCandidate('');
    await Promise.all([load(), onChanged()]);
  }

  return (
    <div>
      {members.map((m) => (
        <div
          key={m.user_id}
          style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}
        >
          <span style={{ flex: 1 }}>{m.name ?? m.email}</span>
          <button
            type="button"
            onClick={async () => {
              await API.removeTeamMember(teamId, m.user_id);
              await Promise.all([load(), onChanged()]);
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {members.length === 0 && <div className="muted">No members in this team.</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <select
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">Add member…</option>
          {addable.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>
        <button type="button" onClick={add} disabled={!candidate}>
          Add
        </button>
        <button
          type="button"
          onClick={async () => {
            await API.deleteTeam(teamId);
            await onDeleted();
          }}
          title="Delete this team (tickets keep their history; assignments are cleared)"
        >
          Delete team
        </button>
      </div>
    </div>
  );
}
