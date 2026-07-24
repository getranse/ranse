import { useCallback, useEffect, useState } from 'react';
import type { Team } from '../../../interfaces/teams';
import type { WorkspaceMember } from '../../../types/shared/workspace';
import { API } from '../../api';
import { TeamMembersEditor } from './TeamMembersEditor';

export function WorkspaceTeamsSection() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const [teamRes, memberRes] = await Promise.all([API.teams(), API.workspaceMembers()]);
    setTeams(teamRes.teams ?? []);
    setMembers(memberRes.members ?? []);
    setSelected((prev) => prev || (teamRes.teams?.[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    await API.createTeam(name.trim());
    setName('');
    await load();
  }

  return (
    <section className="card">
      <h2>Teams</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        New tickets on a mailbox with a default team are assigned round-robin to the team member
        with the fewest open tickets.
      </p>
      <div style={{ display: 'flex', gap: 6, margin: '12px 0' }}>
        <input
          placeholder="New team name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={create} disabled={!name.trim()}>
          Create team
        </button>
      </div>
      {teams.length === 0 ? (
        <div className="muted">No teams yet.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                className={selected === t.id ? 'primary' : ''}
                onClick={() => setSelected(t.id)}
              >
                {t.name} ({t.member_count})
              </button>
            ))}
          </div>
          {selected && (
            <TeamMembersEditor
              teamId={selected}
              workspaceMembers={members}
              onChanged={load}
              onDeleted={async () => {
                setSelected('');
                await load();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
