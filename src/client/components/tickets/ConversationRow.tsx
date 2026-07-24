import { Avatar } from '../ui/Avatar';
import { PriorityPill } from '../ui/StatusPill';

const STATUS_DOT: Record<string, string> = {
  open: 'bg-info',
  pending: 'bg-warning',
  resolved: 'bg-success',
  closed: 'bg-subtle',
  spam: 'bg-danger',
};

function shortAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

export interface ConversationRowData {
  id: string;
  subject: string;
  requester_email: string;
  status: string;
  priority: string;
  last_message_at: number;
  snippet?: string | null;
}

export function ConversationRow({
  ticket,
  active,
  onOpen,
}: {
  ticket: ConversationRowData;
  active?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(ticket.id)}
      className={`flex w-full items-center gap-3 border-border/60 border-b px-4 py-2.5 text-left transition-colors duration-100 hover:bg-hover ${
        active ? 'bg-accent-soft' : ''
      }`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[ticket.status] ?? 'bg-subtle'}`}
      />
      <Avatar name={ticket.requester_email} size={30} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm text-text">{ticket.subject}</span>
        <span className="truncate text-muted text-xs">
          {ticket.snippet?.trim() || ticket.requester_email}
        </span>
      </span>
      <PriorityPill priority={ticket.priority} />
      <span className="shrink-0 text-subtle text-xs tabular-nums">
        {shortAgo(ticket.last_message_at)}
      </span>
    </button>
  );
}
