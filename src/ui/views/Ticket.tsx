import { useEffect, useState } from 'react';
import { API } from '../api';

export function TicketView({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState('');
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [edits, setEdits] = useState<{ subject: string; body_markdown: string }>({ subject: '', body_markdown: '' });

  async function load() {
    setData(await API.ticket(id));
  }
  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="muted">Loading…</div>;

  const ticket = data.ticket;
  const approvals = (data.approvals ?? []).filter((a: any) => a.status === 'pending');

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 12 }}>← Inbox</button>
      <div className="ticket-detail">
        <div>
          <h1>{ticket.subject}</h1>
          <div className="muted" style={{ marginBottom: 16 }}>
            From {ticket.requester_email} · Priority <span className={`pill ${ticket.priority}`}>{ticket.priority}</span>
            {ticket.category && <> · Category {ticket.category}</>}
          </div>

          {approvals.map((ap: any) => {
            const proposed = JSON.parse(ap.proposed_json);
            const reasons = JSON.parse(ap.risk_reasons_json);
            const editing = editingApproval === ap.id;
            return (
              <div key={ap.id} className="approval">
                <strong>Suggested reply — needs your approval</strong>
                {reasons.length > 0 && <div className="risk">Risks: {reasons.join(', ')}</div>}
                {editing ? (
                  <>
                    <div className="field"><label>Subject</label>
                      <input value={edits.subject} onChange={(e) => setEdits({ ...edits, subject: e.target.value })} />
                    </div>
                    <div className="field"><label>Body</label>
                      <textarea rows={8} value={edits.body_markdown} onChange={(e) => setEdits({ ...edits, body_markdown: e.target.value })} />
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginTop: 8 }}><strong>Subject:</strong> {proposed.subject}</div>
                    <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 6 }}>{proposed.body_markdown}</pre>
                  </>
                )}
                <div className="approval-actions">
                  {!editing && <button onClick={() => { setEditingApproval(ap.id); setEdits({ subject: proposed.subject, body_markdown: proposed.body_markdown }); }}>Edit</button>}
                  <button className="primary" onClick={async () => {
                    await API.approve(ap.id, editing ? edits : undefined);
                    setEditingApproval(null);
                    await load();
                  }}>Approve & send</button>
                  <button className="danger" onClick={async () => { await API.reject(ap.id); await load(); }}>Reject</button>
                </div>
              </div>
            );
          })}

          <h2>Thread</h2>
          <div className="thread">
            {data.messages.map((m: any) => (
              <div key={m.id} className={`msg ${m.direction}`}>
                <div className="msg-header">
                  <span>{m.direction === 'inbound' ? m.from_address : m.direction === 'outbound' ? `You → ${m.to_address}` : 'Internal note'}</span>
                  <span>{new Date(m.sent_at).toLocaleString()}</span>
                </div>
                <div className="msg-body">{m.preview}</div>
              </div>
            ))}
          </div>

          <h2>Add internal note</h2>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to teammates only" />
          <button style={{ marginTop: 8 }} disabled={!note.trim()} onClick={async () => { await API.addNote(id, note); setNote(''); await load(); }}>Add note</button>
        </div>

        <aside className="card">
          <strong>Status</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {['open', 'pending', 'resolved', 'closed'].map((s) => (
              <button key={s} className={ticket.status === s ? 'primary' : ''} onClick={async () => { await API.setStatus(id, s); await load(); }}>
                {s}
              </button>
            ))}
          </div>
          <h2 style={{ marginTop: 16 }}>Audit</h2>
          <div style={{ fontSize: 12 }}>
            {data.audit.slice(0, 20).map((a: any) => (
              <div key={a.id} style={{ marginBottom: 6 }}>
                <div className="muted">{new Date(a.created_at).toLocaleString()}</div>
                <div>{a.action}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
