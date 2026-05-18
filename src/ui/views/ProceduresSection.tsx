import { useEffect, useState } from 'react';
import { API, type ProcedureLibraryListEntry, type ProcedureListEntry } from '../api';

interface ProceduresSectionProps {
  onSaved: (message?: string) => void;
}

const DEFAULT_SPEC = `{
  "slug": "refund-intake",
  "name": "Refund intake",
  "version": "1.0.0",
  "description": "Collects refund context and prepares the ticket.",
  "owner": "support-ops",
  "trigger": { "type": "manual" },
  "steps": [
    {
      "id": "find_policy",
      "type": "search",
      "query": "refund policy for {{ ticket.subject }}",
      "scope": "knowledge",
      "max_hops": 2,
      "save_as": "policy"
    },
    {
      "id": "note",
      "type": "add_note",
      "body": "Procedure started. Found {{ policy.hits.0.title }}."
    }
  ],
  "evals": []
}`;

export function ProceduresSection({ onSaved }: ProceduresSectionProps) {
  const [procedures, setProcedures] = useState<ProcedureListEntry[]>([]);
  const [library, setLibrary] = useState<ProcedureLibraryListEntry[]>([]);
  const [draft, setDraft] = useState(DEFAULT_SPEC);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    const [procedureRes, libraryRes] = await Promise.all([
      API.listProcedures(),
      API.listProcedureLibrary(),
    ]);
    setProcedures(procedureRes.procedures ?? []);
    setLibrary(libraryRes.procedures ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <h2>Procedures</h2>
      <div className="card">
        <div className="source-list" style={{ marginBottom: 12 }}>
          {library.map((item) => (
            <div className="source-row" key={item.slug}>
              <div>
                <div style={{ fontWeight: 500 }}>{item.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.category} · {item.risk_level} risk · v{item.version} · {item.eval_count}{' '}
                  evals · {item.provenance.spec_checksum.slice(0, 12)}
                  {item.required_mcp_servers.length > 0
                    ? ` · MCP: ${item.required_mcp_servers.join(', ')}`
                    : ''}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.summary}
                </div>
                {item.readiness && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {readinessLabel(item)}
                  </div>
                )}
              </div>
              <div
                style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}
              >
                <button
                  disabled={busy === `load:${item.slug}`}
                  onClick={async () => {
                    setBusy(`load:${item.slug}`);
                    setError('');
                    try {
                      const detail = await API.procedureLibraryItem(item.slug);
                      setDraft(JSON.stringify(detail.procedure.spec, null, 2));
                      onSaved('Procedure loaded');
                    } catch (err: any) {
                      setError(err.message || 'Load failed');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Load
                </button>
                <button
                  className="primary"
                  disabled={busy === `install:${item.slug}`}
                  onClick={async () => {
                    setBusy(`install:${item.slug}`);
                    setError('');
                    try {
                      await API.installProcedureLibraryItem(item.slug);
                      await load();
                      onSaved('Procedure installed');
                    } catch (err: any) {
                      setError(err.message || 'Install failed');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Install
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="source-list" style={{ marginBottom: 12 }}>
          {procedures.map((procedure) => (
            <div className="source-row" key={procedure.id}>
              <div>
                <div style={{ fontWeight: 500 }}>{procedure.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {procedure.slug} · {procedure.active_version} · {procedure.trigger_type}
                </div>
              </div>
              <span className="pill">{procedure.active_version ?? 'draft'}</span>
            </div>
          ))}
          {procedures.length === 0 && <div className="muted">No procedures published yet.</div>}
        </div>
        <div className="field">
          <label>Publish procedure spec</label>
          <textarea
            rows={14}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button
          className="primary"
          onClick={async () => {
            setError('');
            try {
              await API.publishProcedure(JSON.parse(draft));
              await load();
              onSaved('Procedure published');
            } catch (err: any) {
              setError(err.message || 'Publish failed');
            }
          }}
        >
          Publish
        </button>
      </div>
    </>
  );
}

function readinessLabel(item: ProcedureLibraryListEntry): string {
  if (!item.readiness) return '';
  if (item.readiness.status === 'ready') {
    return `MCP ready: ${item.readiness.ready_tool_count}/${item.readiness.required_tool_count} required tools`;
  }
  const missing = item.readiness.tools
    .filter((tool) => tool.usage !== 'optional' && tool.status !== 'ready')
    .slice(0, 3)
    .map((tool) => `${tool.server}.${tool.tool}`);
  return `MCP setup needed: ${missing.join(', ')}`;
}
