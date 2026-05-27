import { formatDateTime } from '../../lib/format';
import { useEffect, useState } from 'react';
import { API } from '../../api';
import type { WorkspaceAuditEvent, WorkspaceUsage } from '../../../types/workspace';

interface WorkspacePlatformSectionProps {
  onSaved: (message?: string) => void;
}

export function WorkspacePlatformSection({ onSaved }: WorkspacePlatformSectionProps) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [events, setEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [role, setRole] = useState('viewer');

  async function load() {
    const me = await API.me();
    const currentRole = me.workspaces?.find((w) => w.id === me.currentWorkspaceId)?.role ?? 'viewer';
    const [usageRes, auditRes] = await Promise.all([
      API.workspaceUsage(),
      currentRole === 'owner' || currentRole === 'admin' ? API.workspaceAudit() : Promise.resolve({ events: [] }),
    ]);
    setRole(currentRole);
    setUsage(usageRes.usage);
    setEvents(auditRes.events ?? []);
  }

  useEffect(() => { load(); }, []);

  const metrics = usage ? Object.entries(usage) : [];
  const canManage = role === 'owner' || role === 'admin';
  const canDelete = role === 'owner';

  return (
    <>
      <h2>Platform</h2>
      <div className="card">
        <div className="knowledge-grid">
          {metrics.map(([key, value]) => (
            <div key={key}>
              <div className="muted" style={{ fontSize: 12 }}>{key}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
        {canManage && <div className="row" style={{ marginTop: 14 }}>
          <button onClick={async () => {
            await API.workspaceExport();
            onSaved('Export manifest generated');
          }}>
            Generate export manifest
          </button>
          <button onClick={async () => {
            if (!window.confirm('Archive this workspace? Active sessions will be moved away.')) return;
            await API.archiveWorkspace();
            window.location.assign('/');
          }} disabled={!canDelete}>
            Archive workspace
          </button>
          <button className="danger" onClick={async () => {
            if (!window.confirm('Soft-delete this workspace? Active sessions will be moved away.')) return;
            await API.deleteWorkspace();
            window.location.assign('/');
          }} disabled={!canDelete}>
            Delete workspace
          </button>
        </div>}
      </div>

      {canManage && (
        <>
          <h2>Audit log</h2>
          <div className="card">
            <div className="source-list">
              {events.map((event) => (
                <div className="source-row" key={event.id}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{event.action}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {event.actor_type}{event.actor_id ? `:${event.actor_id}` : ''} · {formatDateTime(event.created_at)}
                    </div>
                  </div>
                  <code style={{ fontSize: 11 }}>{event.ticket_id ?? ''}</code>
                </div>
              ))}
              {events.length === 0 && <div className="muted">No audit events yet.</div>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
