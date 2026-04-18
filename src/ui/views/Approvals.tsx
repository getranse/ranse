import { useEffect, useState } from 'react';
import { API } from '../api';

export function ApprovalsView({ onOpenTicket }: { onOpenTicket: (id: string) => void }) {
  const [approvals, setApprovals] = useState<any[]>([]);

  async function load() {
    const d = await API.approvals();
    setApprovals(d.approvals ?? []);
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <h1>Pending approvals</h1>
      {approvals.length === 0 ? (
        <div className="card muted">Nothing pending.</div>
      ) : (
        approvals.map((ap) => {
          const proposed = JSON.parse(ap.proposed_json);
          const reasons = JSON.parse(ap.risk_reasons_json);
          return (
            <div key={ap.id} className="approval">
              <div>
                <strong>To: {proposed.to}</strong>{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); onOpenTicket(ap.ticket_id); }}>open ticket →</a>
              </div>
              <div><strong>Subject:</strong> {proposed.subject}</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 6, maxHeight: 160, overflow: 'auto' }}>
                {proposed.body_markdown}
              </pre>
              {reasons.length > 0 && <div className="risk">Risks: {reasons.join(', ')}</div>}
              <div className="approval-actions">
                <button className="primary" onClick={async () => { await API.approve(ap.id); await load(); }}>Approve & send</button>
                <button className="danger" onClick={async () => { await API.reject(ap.id); await load(); }}>Reject</button>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
