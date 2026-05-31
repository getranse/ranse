import type { WorkspaceGateProps } from '../../../interfaces/client';
import { useState } from 'react';
import { API } from '../../api';

export function WorkspaceGate({ me, onChanged }: WorkspaceGateProps) {
  const [workspaceId, setWorkspaceId] = useState(me.workspaces?.[0]?.id ?? '');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const workspaces = me.workspaces ?? [];

  async function run(action: () => Promise<unknown>) {
    try {
      setError('');
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function inviteToken(value: string) {
    const trimmed = value.trim();
    try {
      const url = new URL(trimmed);
      return url.pathname.split('/invite/')[1] || trimmed;
    } catch {
      return trimmed;
    }
  }

  return (
    <div className="center">
      <div className="card auth-card">
        <h1>Select workspace</h1>
        {workspaces.length > 0 && (
          <>
            <div className="field">
              <label>Workspace</label>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <button className="primary" onClick={() => run(() => API.switchWorkspace(workspaceId))}>Continue</button>
          </>
        )}

        <h2>Create workspace</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} placeholder="Acme Support" onChange={(e) => setName(e.target.value)} />
        </div>
        <button onClick={() => run(() => API.createWorkspace(name.trim()))} disabled={!name.trim()}>
          Create workspace
        </button>

        <h2>Accept invitation</h2>
        <div className="field">
          <label>Invitation token</label>
          <input value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <button onClick={() => run(() => API.acceptInvitation(inviteToken(token)))} disabled={!token.trim()}>
          Join workspace
        </button>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
