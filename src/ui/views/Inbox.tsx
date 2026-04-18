import { useEffect, useState } from 'react';
import { API } from '../api';

const FILTERS = [
  { k: '', label: 'All' },
  { k: 'open', label: 'Open' },
  { k: 'pending', label: 'Pending' },
  { k: 'resolved', label: 'Resolved' },
];

export function InboxView({ onOpen }: { onOpen: (id: string) => void }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    API.tickets(filter || undefined)
      .then((d) => setTickets(d.tickets ?? []))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <>
      <h1>Inbox</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button key={f.k} className={filter === f.k ? 'primary' : ''} onClick={() => setFilter(f.k)}>
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="muted">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          No tickets yet. Send a test email to your support address to see one appear.
        </div>
      ) : (
        <ul className="ticket-list card" style={{ padding: 0 }}>
          {tickets.map((t) => (
            <li key={t.id} onClick={() => onOpen(t.id)}>
              <div>
                <div className="subj">{t.subject}</div>
                <div className="from">{t.requester_email}</div>
              </div>
              <span className={`pill ${t.priority}`}>{t.priority}</span>
              <span className="muted">{new Date(t.last_message_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
