import { useEffect, useState } from 'react';
import { formatDateTime } from '../../../lib/format';
import { API } from '../../api';
import { OnboardingBanner } from '../../components/onboarding/OnboardingBanner';

const FILTERS = [
  { k: '', label: 'All' },
  { k: 'open', label: 'Open' },
  { k: 'pending', label: 'Pending' },
  { k: 'resolved', label: 'Resolved' },
];

export function InboxView({ onOpen }: { onOpen: (id: string) => void }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // A non-empty search replaces the status-filtered list; debounced so we
  // don't hit the API on every keystroke.
  useEffect(() => {
    setLoading(true);
    const q = query.trim();
    if (!q) {
      API.tickets(filter || undefined)
        .then((d) => setTickets(d.tickets ?? []))
        .finally(() => setLoading(false));
      return;
    }
    const handle = setTimeout(() => {
      API.searchTickets(q)
        .then((d) => setTickets(d.tickets ?? []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [filter, query]);

  return (
    <>
      <h1>Inbox</h1>
      <OnboardingBanner onNavigate={(href) => window.location.assign(href)} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <button
            key={f.k}
            className={filter === f.k ? 'primary' : ''}
            onClick={() => setFilter(f.k)}
          >
            {f.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Search tickets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginLeft: 'auto', minWidth: 220 }}
        />
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
              <span className="muted">{formatDateTime(t.last_message_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
