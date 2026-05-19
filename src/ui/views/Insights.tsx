import { useEffect, useState } from 'react';
import { OperationsDashboard } from '../components/OperationsDashboard';
import {
  API,
  type ConversationScoreEntry,
  type InsightSummaryEntry,
  type KbSuggestionEntry,
  type KnowledgeDriftSignalEntry,
} from '../api';

export function InsightsView() {
  const [summary, setSummary] = useState<InsightSummaryEntry | null>(null);
  const [scores, setScores] = useState<ConversationScoreEntry[]>([]);
  const [suggestions, setSuggestions] = useState<KbSuggestionEntry[]>([]);
  const [drift, setDrift] = useState<KnowledgeDriftSignalEntry[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [summaryRes, scoreRes, suggestionRes, driftRes] = await Promise.all([
      API.insightSummary(30),
      API.listConversationScores(10),
      API.listKbSuggestions('open'),
      API.listKnowledgeDrift('open'),
    ]);
    setSummary(summaryRes.summary);
    setScores(scoreRes.scores ?? []);
    setSuggestions(suggestionRes.suggestions ?? []);
    setDrift(driftRes.signals ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Failed to load insights'));
  }, []);

  async function runAll() {
    setError('');
    setBusy('run');
    try {
      await Promise.all([
        API.runConversationScoring(200),
        API.generateKbSuggestions(200),
        API.runKnowledgeDrift(),
      ]);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Insight refresh failed'));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}
      >
        <h1>Insights</h1>
        <button className="primary" disabled={busy === 'run'} onClick={runAll}>
          {busy === 'run' ? 'Refreshing...' : 'Refresh insights'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <OperationsDashboard />

      <div className="insight-grid">
        <Metric label="Resolution" value={percent(summary?.resolution_rate)} />
        <Metric label="Open" value={String(summary?.open_ticket_count ?? 0)} />
        <Metric label="Follow-ups" value={String(summary?.customer_followed_up_count ?? 0)} />
        <Metric label="Quality" value={score(summary?.avg_overall_score)} />
      </div>

      <div className="insight-layout">
        <section className="card">
          <h2>Rubric</h2>
          <div className="source-list">
            {scores.map((item) => (
              <div className="source-row" key={item.id}>
                <div>
                  <div style={{ fontWeight: 500 }}>{item.subject ?? item.ticket_id}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.status} · {item.category ?? 'uncategorized'} · grounded{' '}
                    {score(item.groundedness_score)} · effort {score(item.effort_score)}
                  </div>
                </div>
                <span className={`pill ${item.overall_score >= 0.75 ? 'resolved' : ''}`}>
                  {score(item.overall_score)}
                </span>
              </div>
            ))}
            {scores.length === 0 && <div className="muted">No scorecards yet.</div>}
          </div>
        </section>

        <section className="card">
          <h2>Unanswered intents</h2>
          <div className="source-list">
            {(summary?.top_unresolved_intents ?? []).map((item) => (
              <div className="source-row" key={`${item.intent}:${item.example_ticket_id}`}>
                <div>
                  <div style={{ fontWeight: 500 }}>{item.intent}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Example {item.example_ticket_id}
                  </div>
                </div>
                <span className="pill">{item.count}</span>
              </div>
            ))}
            {(summary?.top_unresolved_intents ?? []).length === 0 && (
              <div className="muted">No unresolved clusters.</div>
            )}
          </div>
        </section>
      </div>

      <div className="insight-layout">
        <section className="card">
          <h2>KB suggestions</h2>
          <div className="source-list">
            {suggestions.map((item) => (
              <div className="source-row" key={item.id}>
                <div>
                  <div style={{ fontWeight: 500 }}>{item.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.summary} ·{' '}
                    {item.evidence_count || jsonArray(item.source_ticket_ids_json).length} tickets ·{' '}
                    {score(item.confidence_score)} confidence
                  </div>
                </div>
                <div className="source-actions">
                  <button
                    className="primary"
                    disabled={busy === `accept:${item.id}`}
                    onClick={async () => {
                      setBusy(`accept:${item.id}`);
                      setError('');
                      try {
                        await API.acceptKbSuggestion(item.id);
                        await load();
                      } catch (err) {
                        setError(errorMessage(err, 'Could not accept suggestion'));
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    Accept
                  </button>
                  <button
                    disabled={busy === `dismiss:${item.id}`}
                    onClick={async () => {
                      setBusy(`dismiss:${item.id}`);
                      setError('');
                      try {
                        await API.updateKbSuggestion(item.id, 'dismissed');
                        await load();
                      } catch (err) {
                        setError(errorMessage(err, 'Could not dismiss suggestion'));
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
            {suggestions.length === 0 && <div className="muted">No suggestions open.</div>}
          </div>
        </section>

        <section className="card">
          <h2>Drift</h2>
          <div className="source-list">
            {drift.map((item) => (
              <div className="source-row" key={item.id}>
                <div>
                  <div style={{ fontWeight: 500 }}>{item.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {item.summary}
                  </div>
                </div>
                <button
                  disabled={busy === `resolve:${item.id}`}
                  onClick={async () => {
                    setBusy(`resolve:${item.id}`);
                    setError('');
                    try {
                      await API.updateKnowledgeDrift(item.id, 'resolved');
                      await load();
                    } catch (err) {
                      setError(errorMessage(err, 'Could not resolve drift signal'));
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Resolve
                </button>
              </div>
            ))}
            {drift.length === 0 && <div className="muted">No open drift signals.</div>}
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Procedure latency</h2>
        <div className="source-list">
          {(summary?.slowest_procedures ?? []).map((item) => (
            <div className="source-row" key={item.procedure_id}>
              <div>
                <div style={{ fontWeight: 500 }}>{item.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.slug} · {item.run_count} runs · {item.waiting_count} waiting ·{' '}
                  {item.failed_count} failed
                </div>
              </div>
              <span className="pill">{duration(item.avg_duration_ms)}</span>
            </div>
          ))}
          {(summary?.slowest_procedures ?? []).length === 0 && (
            <div className="muted">No procedure runs in range.</div>
          )}
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card metric-card">
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function score(value?: number | null): string {
  return value === null || value === undefined ? '-' : Math.round(value * 100).toString();
}

function percent(value?: number | null): string {
  return value === null || value === undefined ? '0%' : `${Math.round(value * 100)}%`;
}

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function jsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
