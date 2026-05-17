import { useEffect, useState } from 'react';
import { API, type ProcedureListEntry } from '../api';

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
  const [draft, setDraft] = useState(DEFAULT_SPEC);
  const [error, setError] = useState('');

  async function load() {
    const res = await API.listProcedures();
    setProcedures(res.procedures ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <h2>Procedures</h2>
      <div className="card">
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
