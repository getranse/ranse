import type { ProposedReply, ReplyEdits, TicketViewData } from '../../types/ticket';
import { AnswerInspection } from './AnswerInspection';

interface TicketApprovalCardProps {
  approval: TicketViewData['approvals'][number];
  editing: boolean;
  edits: ReplyEdits;
  setEdits: (edits: ReplyEdits) => void;
  onEdit: (proposed: ProposedReply) => void;
  onApprove: (edits?: ReplyEdits) => Promise<void>;
  onReject: () => Promise<void>;
}

export function TicketApprovalCard({
  approval,
  editing,
  edits,
  setEdits,
  onEdit,
  onApprove,
  onReject,
}: TicketApprovalCardProps) {
  const proposed = JSON.parse(approval.proposed_json) as ProposedReply & Record<string, any>;
  const reasons = JSON.parse(approval.risk_reasons_json) as string[];
  const isExternalAction = approval.kind === 'call_external' || proposed.kind === 'mcp_tool_call';
  const citedIds = new Set(proposed.cites_knowledge_ids ?? []);

  return (
    <div className="approval">
      <strong>{isExternalAction ? 'External action needs your approval' : 'Suggested reply — needs your approval'}</strong>
      {reasons.length > 0 && <div className="risk">Risks: {reasons.join(', ')}</div>}
      {isExternalAction ? (
        <div style={{ marginTop: 8 }}>
          <div>
            <strong>Tool:</strong> {proposed.server_name}.{proposed.tool_name}
          </div>
          {proposed.tool_title && (
            <div>
              <strong>Name:</strong> {proposed.tool_title}
            </div>
          )}
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12, marginTop: 8 }}>
            {JSON.stringify(proposed.args ?? {}, null, 2)}
          </pre>
        </div>
      ) : editing ? (
        <>
          <div className="field">
            <label>Subject</label>
            <input
              value={edits.subject}
              onChange={(e) => setEdits({ ...edits, subject: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Body</label>
            <textarea
              rows={8}
              value={edits.body_markdown}
              onChange={(e) => setEdits({ ...edits, body_markdown: e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 8 }}>
            <strong>Subject:</strong> {proposed.subject}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 6 }}>
            {proposed.body_markdown}
          </pre>
          <AnswerInspection
            hits={(proposed.knowledge_hits ?? []).map((hit) => ({
              ...hit,
              cited: citedIds.has(hit.id),
            }))}
            trace={proposed.knowledge_trace}
          />
        </>
      )}
      <div className="approval-actions">
        {!editing && !isExternalAction && <button onClick={() => onEdit(proposed)}>Edit</button>}
        <button className="primary" onClick={() => onApprove(editing ? edits : undefined)}>
          {isExternalAction ? 'Approve action' : 'Approve & send'}
        </button>
        <button className="danger" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
