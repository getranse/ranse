import { useEffect, useState } from 'react';
import { API, type ProactiveProposalResponse } from '../api';

// Phase 11 capstone surface: operator review queue for proposals drafted by
// the proactive resolution loop. Each card surfaces the cluster summary,
// draft procedure spec, eval pass rate, and Accept / Reject controls.

export function ProactiveProposalsPanel() {
  const [proposals, setProposals] = useState<ProactiveProposalResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    API.proposals('pending')
      .then((r) => setProposals(r.proposals))
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAccept(id: string) {
    setBusy(id);
    try {
      await API.acceptProposal(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(id: string) {
    const reason = window.prompt('Why reject?', 'not relevant');
    if (!reason) return;
    setBusy(id);
    try {
      await API.rejectProposal(id, reason);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleRun() {
    setLoading(true);
    try {
      await API.runProposals();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0 }}>Proactive proposals</h2>
        <button type="button" onClick={handleRun} disabled={loading}>
          Run discovery
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && !proposals.length && <div className="muted">Loading…</div>}
      {!loading && proposals.length === 0 && (
        <div className="muted">No pending proposals. The loop runs weekly.</div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            disabled={busy === p.id}
            onAccept={() => handleAccept(p.id)}
            onReject={() => handleReject(p.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ProposalCard({
  proposal,
  disabled,
  onAccept,
  onReject,
}: {
  proposal: ProactiveProposalResponse;
  disabled: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const spec = proposal.draft_procedure_spec_json
    ? JSON.parse(proposal.draft_procedure_spec_json)
    : null;
  const evidenceCount = proposal.evidence_ticket_ids_json
    ? JSON.parse(proposal.evidence_ticket_ids_json).length
    : 0;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>{spec?.name ?? proposal.cluster_key}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {proposal.kind} · {evidenceCount} ticket{evidenceCount === 1 ? '' : 's'} · evals{' '}
          {proposal.eval_pass_rate !== null
            ? `${(proposal.eval_pass_rate * 100).toFixed(0)}%`
            : '—'}
        </div>
      </div>
      {proposal.summary && <div style={{ fontSize: 13 }}>{proposal.summary}</div>}
      {spec && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <span className="muted">Steps: </span>
          {spec.steps?.map((s: any) => s.id).join(' → ')}
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button type="button" onClick={onAccept} disabled={disabled}>
          Accept
        </button>
        <button type="button" onClick={onReject} disabled={disabled} className="secondary">
          Reject
        </button>
      </div>
    </div>
  );
}
