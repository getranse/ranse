import type { TicketViewData } from '../../types/ticket';
import { API } from '../api';

interface TicketSidebarProps {
  ticket: TicketViewData['ticket'];
  audit: TicketViewData['audit'];
  onReload: () => Promise<void>;
}

export function TicketSidebar({ ticket, audit, onReload }: TicketSidebarProps) {
  return (
    <aside className="card">
      <strong>Status</strong>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {['open', 'pending', 'resolved', 'closed'].map((status) => (
          <button
            key={status}
            className={ticket.status === status ? 'primary' : ''}
            onClick={async () => {
              await API.setStatus(ticket.id, status);
              await onReload();
            }}
          >
            {status}
          </button>
        ))}
      </div>
      <h2 style={{ marginTop: 16 }}>AI auto-drafts</h2>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        <select
          value={
            ticket.ai_drafts_enabled === null || ticket.ai_drafts_enabled === undefined
              ? 'inherit'
              : ticket.ai_drafts_enabled === 1
                ? 'on'
                : 'off'
          }
          onChange={async (e) => {
            const value = e.target.value;
            const enabled = value === 'inherit' ? null : value === 'on';
            await API.setTicketAiDrafts(ticket.id, enabled);
            await onReload();
          }}
          style={{ width: '100%', padding: 4 }}
        >
          <option value="inherit">Inherit workspace default</option>
          <option value="on">On for this ticket</option>
          <option value="off">Off for this ticket</option>
        </select>
      </div>
      <h2 style={{ marginTop: 16 }}>Audit</h2>
      <div style={{ fontSize: 12 }}>
        {audit.slice(0, 20).map((event) => (
          <div key={event.id} style={{ marginBottom: 6 }}>
            <div className="muted">{new Date(event.created_at).toLocaleString()}</div>
            <div>{event.action}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
