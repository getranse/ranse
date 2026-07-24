import { useEffect, useState } from 'react';
import type { ReplyEdits, TicketViewData } from '../../../types/shared/ticket';
import { type AnswerInspectionHit, type AnswerInspectionTrace, API } from '../../api';
import { DraftAssistPanel } from '../../components/tickets/DraftAssistPanel';
import { MacroPicker } from '../../components/tickets/MacroPicker';
import { MessageThread } from '../../components/tickets/MessageThread';
import { AnswerInspection } from '../knowledge/AnswerInspection';
import { TicketApprovalCard } from './TicketApprovalCard';
import { TicketSidebar } from './TicketSidebar';

export function TicketView({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<TicketViewData | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [draftKnowledge, setDraftKnowledge] = useState<AnswerInspectionHit[]>([]);
  const [draftTrace, setDraftTrace] = useState<AnswerInspectionTrace | undefined>();
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [edits, setEdits] = useState<ReplyEdits>({
    subject: '',
    body_markdown: '',
  });

  async function load() {
    setData(await API.ticket<TicketViewData>(id));
  }
  useEffect(() => {
    load();
  }, [id]);

  if (!data) return <div className="muted">Loading…</div>;

  const ticket = data.ticket;
  const approvals = (data.approvals ?? []).filter((a) => a.status === 'pending');

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← Inbox
      </button>
      <div className="ticket-detail">
        <div>
          <h1>{ticket.subject}</h1>
          <div className="muted" style={{ marginBottom: 16 }}>
            From {ticket.requester_email} · Priority{' '}
            <span className={`pill ${ticket.priority}`}>{ticket.priority}</span>
            {ticket.category && <> · Category {ticket.category}</>}
          </div>

          {approvals.map((approval) => (
            <TicketApprovalCard
              key={approval.id}
              approval={approval}
              editing={editingApproval === approval.id}
              edits={edits}
              setEdits={setEdits}
              onEdit={(proposed) => {
                setEditingApproval(approval.id);
                setEdits({
                  subject: proposed.subject ?? '',
                  body_markdown: proposed.body_markdown ?? '',
                });
              }}
              onApprove={async (nextEdits) => {
                await API.approve(approval.id, nextEdits);
                setEditingApproval(null);
                await load();
              }}
              onReject={async () => {
                await API.reject(approval.id);
                await load();
              }}
            />
          ))}

          <h2>Thread</h2>
          <MessageThread messages={data.messages} />

          <h2>Reply</h2>
          <textarea
            rows={6}
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              if (!e.target.value.trim()) {
                setDraftKnowledge([]);
                setDraftTrace(undefined);
              }
            }}
            placeholder={`Reply to ${ticket.requester_email}…`}
          />
          <AnswerInspection hits={draftKnowledge} trace={draftTrace} />
          <DraftAssistPanel
            ticketId={id}
            draft={reply}
            onAcceptCompletion={(completion) =>
              setReply((prev) => (prev.endsWith(' ') ? prev + completion : `${prev} ${completion}`))
            }
          />
          {error && (
            <div className="error" style={{ marginTop: 6 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <MacroPicker
              vars={{
                customer_email: ticket.requester_email,
                customer_name: ticket.requester_name ?? ticket.requester_email,
                ticket_subject: ticket.subject,
              }}
              onInsert={(body) => setReply((prev) => (prev.trim() ? `${prev}\n\n${body}` : body))}
            />
            <button
              className="primary"
              disabled={!reply.trim() || sending}
              onClick={async () => {
                setSending(true);
                setError('');
                try {
                  const citedKnowledgeIds = draftKnowledge
                    .filter((hit) => hit.cited)
                    .map((hit) => hit.id);
                  const res = await API.reply(
                    id,
                    reply,
                    replySubject || undefined,
                    citedKnowledgeIds,
                  );
                  if (!res.ok) throw new Error(res.error || 'Send failed');
                  setReply('');
                  setReplySubject('');
                  setDraftKnowledge([]);
                  setDraftTrace(undefined);
                  await load();
                } catch (err: any) {
                  setError(err.message || 'Send failed');
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? 'Sending…' : 'Send reply'}
            </button>
            <button
              disabled={drafting}
              onClick={async () => {
                setDrafting(true);
                setError('');
                try {
                  const res = await API.draftWithAI(id);
                  if (!res.ok) throw new Error(res.error || 'Draft failed');
                  if (res.body) setReply(res.body);
                  if (res.subject) setReplySubject(res.subject);
                  setDraftKnowledge(res.knowledge ?? []);
                  setDraftTrace(res.knowledgeTrace);
                } catch (err: any) {
                  setError(err.message || 'Draft failed');
                } finally {
                  setDrafting(false);
                }
              }}
              title="Generate an AI suggestion for this reply. Populates the textarea — review and edit before sending."
            >
              {drafting ? 'Drafting…' : 'Suggest with AI'}
            </button>
          </div>

          <h2 style={{ marginTop: 24 }}>Add internal note</h2>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Visible to teammates only"
          />
          <button
            style={{ marginTop: 8 }}
            disabled={!note.trim()}
            onClick={async () => {
              await API.addNote(id, note);
              setNote('');
              await load();
            }}
          >
            Add note
          </button>
        </div>

        <TicketSidebar
          ticket={ticket}
          audit={data.audit}
          outcomes={data.outcomes}
          feedback={data.feedback}
          procedureRuns={data.procedureRuns}
          mcpToolCalls={data.mcpToolCalls}
          onReload={load}
        />
      </div>
    </div>
  );
}
