import type { WorkspaceSwitcherProps } from '../../../interfaces/client';
import { useState } from 'react';
import { API } from '../../api';

export function WorkspaceSwitcher({ me, onChanged }: WorkspaceSwitcherProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const workspaces = me.workspaces ?? [];

  async function createWorkspace() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await API.createWorkspace(trimmed);
    setName('');
    setCreating(false);
    onChanged();
  }

  return (
    <div className="workspace-switcher">
      <label>Workspace</label>
      <select
        value={me.currentWorkspaceId ?? ''}
        onChange={async (e) => {
          if (!e.target.value) return;
          await API.switchWorkspace(e.target.value);
          onChanged();
        }}
      >
        {!me.currentWorkspaceId && <option value="">Select workspace</option>}
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
      {creating ? (
        <div className="workspace-create">
          <input value={name} placeholder="Workspace name" onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <button className="primary" onClick={createWorkspace}>Create</button>
            <button onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)}>New workspace</button>
      )}
    </div>
  );
}
