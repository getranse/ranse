import type { WorkspacePlatformSectionProps } from '../../../interfaces/client';
import { useEffect, useState } from 'react';
import { API } from '../../api';
import { formatDateTime } from '../../../lib/format';
import type { WorkspaceUsage } from '../../../types/shared/workspace';
import type { AuditCategory, AuditEventRecord, AuditQuery } from '../../../types/shared/audit';

const CATEGORIES: (AuditCategory | '')[] = [
  '',
  'auth',
  'security',
  'admin',
  'data',
  'billing',
  'channel',
  'knowledge',
  'procedure',
  'notification',
  'general',
];

const SEVERITY_COLOR: Record<string, string> = {
  info: '#64748b',
  notice: '#0ea5e9',
  warning: '#ea580c',
  critical: '#dc2626',
};

export function WorkspacePlatformSection({ onSaved }: WorkspacePlatformSectionProps) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [role, setRole] = useState('viewer');
  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [actionFilter, setActionFilter] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');

  const canManage = role === 'owner' || role === 'admin';
  const canDelete = role === 'owner';

  function query(): AuditQuery {
    return {
      category: category || undefined,
      action: actionFilter.trim() || undefined,
      limit: 200,
    };
  }

  async function loadAudit() {
    const auditRes = await API.workspaceAudit(query());
    setEvents(auditRes.events ?? []);
  }

  async function load() {
    const me = await API.me();
    const currentRole =
      me.workspaces?.find((w) => w.id === me.currentWorkspaceId)?.role ?? 'viewer';
    setRole(currentRole);
    const usageRes = await API.workspaceUsage();
    setUsage(usageRes.usage);
    if (currentRole === 'owner' || currentRole === 'admin') {
      const auditRes = await API.workspaceAudit(query());
      setEvents(auditRes.events ?? []);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = usage ? Object.entries(usage) : [];

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
        {canManage && (
          <div className="row" style={{ marginTop: 14 }}>
            <button
              onClick={async () => {
                await API.workspaceExport();
                onSaved('Export manifest generated');
              }}
            >
              Generate export manifest
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('Archive this workspace? Active sessions will be moved away.'))
                  return;
                await API.archiveWorkspace();
                window.location.assign('/');
              }}
              disabled={!canDelete}
            >
              Archive workspace
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (!window.confirm('Soft-delete this workspace? Active sessions will be moved away.'))
                  return;
                await API.deleteWorkspace();
                window.location.assign('/');
              }}
              disabled={!canDelete}
            >
              Delete workspace
            </button>
          </div>
        )}
      </div>

      {canManage && (
        <>
          <h2>Audit log</h2>
          <div className="card">
            <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AuditCategory | '')}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat || 'All categories'}
                  </option>
                ))}
              </select>
              <input
                value={actionFilter}
                placeholder="Filter by action (e.g. auth.login)"
                onChange={(e) => setActionFilter(e.target.value)}
              />
              <button onClick={loadAudit}>Apply</button>
              <button onClick={() => window.open(API.workspaceAuditExportUrl(query()), '_blank')}>
                Export CSV
              </button>
              <button
                onClick={async () => {
                  const result = await API.workspaceAuditVerify();
                  setVerifyMsg(
                    result.ok
                      ? `✓ Chain intact (${result.checked} events verified)`
                      : `✗ Tampering detected at ${result.brokenAt} (after ${result.checked} OK)`,
                  );
                }}
              >
                Verify integrity
              </button>
              {verifyMsg && (
                <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                  {verifyMsg}
                </span>
              )}
            </div>
            <div className="source-list">
              {events.map((event) => (
                <div className="source-row" key={event.id}>
                  <div>
                    <div style={{ fontWeight: 500, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span
                        className="pill"
                        style={{
                          background: SEVERITY_COLOR[event.severity] ?? '#64748b',
                          color: 'white',
                          fontSize: 10,
                        }}
                      >
                        {event.category}
                      </span>
                      {event.action}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {event.actor_email ??
                        `${event.actor_type}${event.actor_id ? `:${event.actor_id}` : ''}`}
                      {event.ip ? ` · ${event.ip}` : ''} · {formatDateTime(event.created_at)}
                    </div>
                    {event.payload_json && event.payload_json !== '{}' && (
                      <code style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                        {event.payload_json}
                      </code>
                    )}
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
