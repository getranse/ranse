import { useEffect, useRef, useState } from 'react';
import type { AssistState, DraftAssistPanelProps } from '../../../interfaces/client';
import { formatDate } from '../../../lib/format';
import { API } from '../../api';

const INITIAL_STATE: AssistState = {
  loading: false,
  completion: '',
  confidence: 0,
  knowledge: [],
  similar: [],
  error: null,
};

const DEBOUNCE_MS = 300;
const MIN_DRAFT_CHARS = 8;

export function DraftAssistPanel({ ticketId, draft, onAcceptCompletion }: DraftAssistPanelProps) {
  const [state, setState] = useState<AssistState>(INITIAL_STATE);
  const lastSent = useRef<string>('');
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed.length < MIN_DRAFT_CHARS) {
      setState(INITIAL_STATE);
      return;
    }
    // Only re-fire when the draft actually changed enough to matter — a
    // single-character keystroke doesn't help, and 100ms-bursts shouldn't
    // each hit the LLM.
    if (sameAsLast(trimmed, lastSent.current)) return;

    const timer = setTimeout(() => {
      lastSent.current = trimmed;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      API.draftAssist(ticketId, draft, draft.length)
        .then((res) => {
          if (controller.signal.aborted) return;
          setState({
            loading: false,
            completion: res.completion ?? '',
            confidence: res.confidence ?? 0,
            knowledge: res.knowledge ?? [],
            similar: res.similar ?? [],
            error: null,
          });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : 'Assist failed',
          }));
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, ticketId]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Tab') return;
      if (!state.completion || state.confidence < 0.4) return;
      const active = document.activeElement;
      if (!active || active.tagName !== 'TEXTAREA') return;
      ev.preventDefault();
      onAcceptCompletion(state.completion);
      setState((prev) => ({ ...prev, completion: '' }));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.completion, state.confidence, onAcceptCompletion]);

  const showSuggestion = state.completion && state.confidence >= 0.4;
  const hasSidebar = state.knowledge.length > 0 || state.similar.length > 0;
  if (!showSuggestion && !hasSidebar && !state.loading) return null;

  return (
    <div
      className="card"
      style={{ marginTop: 8, padding: 12, background: '#f8fafc', display: 'grid', gap: 8 }}
    >
      {state.loading && (
        <div className="muted" style={{ fontSize: 12 }}>
          Thinking…
        </div>
      )}
      {showSuggestion && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Suggested continuation · {Math.round(state.confidence * 100)}%
            <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
              press Tab to accept
            </span>
          </div>
          <button
            type="button"
            style={{
              fontStyle: 'italic',
              color: '#0f172a',
              background: '#fff',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px dashed #cbd5e1',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              font: 'inherit',
            }}
            onClick={() => {
              onAcceptCompletion(state.completion);
              setState((prev) => ({ ...prev, completion: '' }));
            }}
            title="Click to accept this suggestion"
          >
            {state.completion}
          </button>
        </div>
      )}
      {state.knowledge.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Knowledge nearby
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            {state.knowledge.slice(0, 4).map((hit) => (
              <li key={hit.id}>
                {hit.url ? (
                  <a href={hit.url} target="_blank" rel="noreferrer">
                    {hit.title}
                  </a>
                ) : (
                  hit.title
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.similar.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Similar resolved tickets
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            {state.similar.map((ticket) => (
              <li key={ticket.id}>
                <a href={`/tickets/${ticket.id}`}>{ticket.subject}</a>
                {ticket.resolved_at && (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    {formatDate(ticket.resolved_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.error && (
        <div className="muted" style={{ fontSize: 12, color: '#b91c1c' }}>
          {state.error}
        </div>
      )}
    </div>
  );
}

function sameAsLast(current: string, last: string): boolean {
  if (current === last) return true;
  // Treat near-identical trailing edits (cursor moves, single chars) as
  // unchanged so we don't burn LLM calls on every keystroke.
  if (
    Math.abs(current.length - last.length) < 3 &&
    current.startsWith(last.slice(0, last.length - 3))
  ) {
    return true;
  }
  return false;
}
