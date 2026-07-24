import { useEffect, useState } from 'react';
import type { TicketSidebarProps } from '../../../interfaces/client';
import { formatDateTime } from '../../../lib/format';
import { API, type ProcedureListEntry } from '../../api';
import { CustomerMemoryDrawer } from '../../components/tickets/CustomerMemoryDrawer';
import { TicketTags } from '../../components/tickets/TicketTags';

export function TicketSidebar({
  ticket,
  audit,
  outcomes = [],
  feedback = [],
  procedureRuns = [],
  mcpToolCalls = [],
  onReload,
}: TicketSidebarProps) {
  const [procedures, setProcedures] = useState<ProcedureListEntry[]>([]);
  const [selectedProcedure, setSelectedProcedure] = useState('');

  useEffect(() => {
    API.listProcedures()
      .then((res) => {
        setProcedures(res.procedures ?? []);
        setSelectedProcedure(res.procedures?.[0]?.slug ?? '');
      })
      .catch(() => undefined);
  }, []);

  async function recordFeedback(rating: 'positive' | 'negative') {
    await API.recordTicketFeedback(ticket.id, rating);
    await onReload();
  }

  function aiDraftsValue(enabled: number | null | undefined): string {
    return enabled == null ? 'inherit' : enabled === 1 ? 'on' : 'off';
  }

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
      <TicketTags ticketId={ticket.id} />
      <h2 style={{ marginTop: 16 }}>AI auto-drafts</h2>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        <select
          value={aiDraftsValue(ticket.ai_drafts_enabled)}
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
      <h2 style={{ marginTop: 16 }}>Feedback</h2>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button onClick={() => recordFeedback('positive')}>Helpful</button>
        <button onClick={() => recordFeedback('negative')}>Needs work</button>
      </div>
      {feedback.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Latest: {feedback[0].rating}
        </div>
      )}
      {outcomes.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>Outcomes</h2>
          <div style={{ fontSize: 12 }}>
            {outcomes.slice(0, 6).map((event) => (
              <div key={event.id} style={{ marginBottom: 6 }}>
                <div className="muted">{formatDateTime(event.created_at)}</div>
                <div>
                  {event.kind}
                  {typeof event.confidence_score === 'number'
                    ? ` · ${Math.round(event.confidence_score * 100)}%`
                    : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <h2 style={{ marginTop: 16 }}>Procedures</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {procedures.length > 0 ? (
          <>
            <select
              value={selectedProcedure}
              onChange={(e) => setSelectedProcedure(e.target.value)}
              style={{ width: '100%' }}
            >
              {procedures.map((procedure) => (
                <option key={procedure.id} value={procedure.slug}>
                  {procedure.name} · {procedure.active_version}
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (!selectedProcedure) return;
                await API.startProcedureRun(selectedProcedure, ticket.id, {
                  ticket: {
                    id: ticket.id,
                    subject: ticket.subject,
                    requester_email: ticket.requester_email,
                    status: ticket.status,
                    priority: ticket.priority,
                    category: ticket.category ?? null,
                  },
                });
                await onReload();
              }}
            >
              Run procedure
            </button>
          </>
        ) : (
          <div className="muted">No active procedures.</div>
        )}
        {procedureRuns.slice(0, 5).map((run) => (
          <div key={run.id} style={{ fontSize: 12 }}>
            <div>
              <span className={`pill ${run.status === 'completed' ? 'resolved' : ''}`}>
                {run.status}
              </span>{' '}
              {run.procedure_id}
            </div>
            {run.error && <div className="error">{run.error}</div>}
          </div>
        ))}
      </div>
      {mcpToolCalls.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>MCP actions</h2>
          <div style={{ fontSize: 12 }}>
            {mcpToolCalls.slice(0, 6).map((call) => (
              <div key={call.id} style={{ marginBottom: 8 }}>
                <div>
                  <span className={`pill ${call.status === 'completed' ? 'resolved' : ''}`}>
                    {call.status}
                  </span>{' '}
                  {call.server_name}.{call.tool_name}
                </div>
                {call.error && <div className="error">{call.error}</div>}
              </div>
            ))}
          </div>
        </>
      )}
      {ticket.customer_id && (
        <CustomerMemoryDrawer
          customerId={ticket.customer_id}
          customerName={ticket.requester_name ?? ticket.requester_email}
        />
      )}
      <h2 style={{ marginTop: 16 }}>Audit</h2>
      <div style={{ fontSize: 12 }}>
        {audit.slice(0, 20).map((event) => (
          <div key={event.id} style={{ marginBottom: 6 }}>
            <div className="muted">{formatDateTime(event.created_at)}</div>
            <div>{event.action}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
