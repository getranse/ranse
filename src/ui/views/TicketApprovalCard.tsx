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
  const proposed = JSON.parse(approval.proposed_json) as ProposedReply;
  const reasons = JSON.parse(approval.risk_reasons_json) as string[];
  const citedIds = new Set(proposed.cites_knowledge_ids ?? []);

  return (
    <div className="approval">
      <strong>Suggested reply — needs your approval</strong>
      {reasons.length > 0 && <div className="risk">Risks: {reasons.join(', ')}</div>}
      {editing ? (
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
        {!editing && <button onClick={() => onEdit(proposed)}>Edit</button>}
        <button className="primary" onClick={() => onApprove(editing ? edits : undefined)}>
          Approve & send
        </button>
        <button className="danger" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
