import { useEffect, useState } from 'react';
import type { WorkspaceMembersSectionProps } from '../../../interfaces/client';
import {
  WORKSPACE_ROLES,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspaceRole,
} from '../../../types/shared/workspaces';
import { API } from '../../api';

export function WorkspaceMembersSection({ onSaved }: WorkspaceMembersSectionProps) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('viewer');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [invite, setInvite] = useState<{ email: string; role: WorkspaceRole }>({
    email: '',
    role: 'agent',
  });
  const [currentUserId, setCurrentUserId] = useState('');
  const canManage = role === 'owner' || role === 'admin';
  const assignableRoleOptions =
    role === 'owner' ? WORKSPACE_ROLES : WORKSPACE_ROLES.filter((r) => r !== 'owner');

  async function load() {
    const [me, memberRes] = await Promise.all([API.me(), API.workspaceMembers()]);
    const current = me.workspaces?.find((w) => w.id === me.currentWorkspaceId);
    setCurrentUserId(me.user?.id ?? '');
    setWorkspaceName(current?.name ?? '');
    setRole(current?.role ?? 'viewer');
    setMembers(memberRes.members ?? []);
    if (current?.role === 'owner' || current?.role === 'admin') {
      const inviteRes = await API.workspaceInvitations();
      setInvitations(inviteRes.invitations ?? []);
    } else {
      setInvitations([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveInvite() {
    if (!invite.email.trim()) return;
    await API.inviteWorkspaceMember({ email: invite.email.trim(), role: invite.role });
    setInvite({ email: '', role: 'agent' });
    onSaved('Invitation created');
    await load();
  }

  return (
    <>
      <h2>Workspace</h2>
      <div className="card">
        <div className="field">
          <label>Name</label>
          <input
            value={workspaceName}
            disabled={!canManage}
            onChange={(e) => setWorkspaceName(e.target.value)}
            onBlur={async () => {
              if (!canManage || !workspaceName.trim()) return;
              await API.updateWorkspace({ name: workspaceName.trim() });
              onSaved('Workspace saved');
              await load();
            }}
          />
        </div>

        <div className="source-list">
          {members.map((member) => (
            <div className="source-row" key={member.user_id}>
              <div>
                <div style={{ fontWeight: 500 }}>{member.name || member.email}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {member.email}
                </div>
              </div>
              <div className="source-actions">
                <select
                  value={member.role}
                  disabled={!canManage || (role !== 'owner' && member.role === 'owner')}
                  onChange={async (e) => {
                    await API.updateWorkspaceMember(
                      member.user_id,
                      e.target.value as WorkspaceRole,
                    );
                    onSaved('Role updated');
                    await load();
                  }}
                >
                  {WORKSPACE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {canManage && role === 'owner' && (
                  <>
                    {member.user_id !== currentUserId && (
                      <button
                        onClick={async () => {
                          await API.transferWorkspaceOwnership(member.user_id);
                          onSaved('Ownership transferred');
                          await load();
                        }}
                      >
                        Transfer owner
                      </button>
                    )}
                    {member.user_id !== currentUserId && (
                      <button
                        className="danger"
                        onClick={async () => {
                          await API.removeWorkspaceMember(member.user_id);
                          onSaved('Member removed');
                          await load();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {canManage && (
          <>
            <h2>Invite member</h2>
            <div className="row">
              <input
                value={invite.email}
                placeholder="agent@example.com"
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              />
              <select
                value={invite.role}
                onChange={(e) => setInvite({ ...invite, role: e.target.value as WorkspaceRole })}
              >
                {assignableRoleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={saveInvite}>
                Invite
              </button>
            </div>
            {invitations.length > 0 && (
              <div className="source-list">
                {invitations.map((item) => (
                  <div className="source-row" key={item.id}>
                    <div>
                      <div>{item.email}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {item.accepted_at ? 'Accepted' : 'Pending'} · {item.role}
                      </div>
                    </div>
                    <input
                      readOnly
                      value={item.accept_url ?? item.token}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
