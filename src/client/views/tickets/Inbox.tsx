import { useEffect, useState } from 'react';
import { API } from '../../api';
import { toast } from '../../components/common/toast';
import { OnboardingBanner } from '../../components/onboarding/OnboardingBanner';
import { ConversationRow } from '../../components/tickets/ConversationRow';
import { EmptyState } from '../../components/ui/EmptyState';
import { RowSkeletons } from '../../components/ui/Skeleton';

const FILTERS = [
  { k: 'open', label: 'Open' },
  { k: 'pending', label: 'Pending' },
  { k: 'resolved', label: 'Resolved' },
  { k: '', label: 'All' },
];

export function InboxView({ onOpen }: { onOpen: (id: string) => void }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // A non-empty search replaces the status-filtered list; debounced.
  useEffect(() => {
    setLoading(true);
    const q = query.trim();
    const run = q ? () => API.searchTickets(q) : () => API.tickets(filter || undefined);
    const handle = setTimeout(
      () => {
        run()
          .then((d) => setTickets(d.tickets ?? []))
          .catch(() => toast.error("Couldn't load conversations."))
          .finally(() => setLoading(false));
      },
      q ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [filter, query]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <h1 className="font-semibold text-text text-xl tracking-tight">Inbox</h1>
        {!loading && <span className="text-subtle text-sm tabular-nums">{tickets.length}</span>}
        <input
          type="search"
          placeholder="Search conversations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent focus:shadow-[var(--focus-ring)]"
        />
      </header>
      <div className="flex gap-1 px-4 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            className={`rounded-md px-2.5 py-1 font-medium text-sm transition-colors ${
              filter === f.k && !query
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-hover hover:text-text'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <OnboardingBanner onNavigate={(href) => window.location.assign(href)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <RowSkeletons />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={query ? '🔍' : '✳️'}
            title={query ? 'No matches' : 'Inbox zero'}
            hint={
              query
                ? 'No conversations match that search.'
                : 'Nothing waiting. Send a test email to your support address to see one land here.'
            }
          />
        ) : (
          tickets.map((t) => <ConversationRow key={t.id} ticket={t} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}
