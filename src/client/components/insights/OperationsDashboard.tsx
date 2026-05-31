import { useEffect, useState } from 'react';
import {
  API,
  type HonestResolutionResponse,
  type KnowledgeHealthResponse,
  type OperationsMetricsResponse,
  type OutcomeStatementResponse,
} from '../../api';
import { formatDuration, formatPercent } from '../../../lib/format';
import { Metric } from './Metric';
import { HonestResolutionCard, KnowledgeHealthCard, OutcomeStatementCard } from './OperationsCards';

// Operations dashboard. Renders the metrics computeOperationsMetrics
// returns: ticket volume per channel, resolution mix, deflection rate,
// time-to-first-response + time-to-resolution percentiles, CSAT, and
// follow-up rate. The window selector (7/30/90 days) re-fetches.

import { WINDOW_OPTIONS } from '../../../config/insights';

export function OperationsDashboard() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<OperationsMetricsResponse | null>(null);
  const [honest, setHonest] = useState<HonestResolutionResponse | null>(null);
  const [statement, setStatement] = useState<OutcomeStatementResponse | null>(null);
  const [health, setHealth] = useState<KnowledgeHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      API.operationsMetrics(days),
      API.honestResolution(days),
      API.outcomeStatement(days),
      API.knowledgeHealth().catch(() => ({ health: null })),
    ])
      .then(([ops, hr, s, kh]) => {
        setMetrics(ops.metrics);
        setHonest(hr.metrics);
        setStatement(s.statement);
        setHealth(('health' in kh ? kh.health : null) as KnowledgeHealthResponse | null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0 }}>Operations</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {WINDOW_OPTIONS.map((opt) => (
            <option value={opt} key={opt}>
              Last {opt} days
            </option>
          ))}
        </select>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && !metrics && <div className="muted">Loading…</div>}
      {metrics && (
        <>
          <div className="insight-grid">
            <Metric label="Tickets" value={String(metrics.volume.total)} />
            <Metric label="Resolved" value={formatPercent(metrics.resolution.rate)} />
            <Metric
              label="Autonomous"
              value={formatPercent(metrics.deflection.rate)}
              sublabel={`${metrics.deflection.autonomousResolved} of ${
                metrics.deflection.autonomousResolved + metrics.deflection.humanResolved
              }`}
            />
            <Metric
              label="CSAT"
              value={
                metrics.satisfaction.csatScore === null
                  ? '—'
                  : formatPercent((metrics.satisfaction.csatScore + 1) / 2)
              }
              sublabel={`${metrics.satisfaction.positiveCount}↑ ${metrics.satisfaction.negativeCount}↓`}
            />
          </div>
          <div className="insight-grid" style={{ marginTop: 8 }}>
            <Metric
              label="TTFR p50"
              value={formatDuration(metrics.responseTime.ttfrMedianMs)}
              sublabel={`p90 ${formatDuration(metrics.responseTime.ttfrP90Ms)}`}
            />
            <Metric
              label="TTR p50"
              value={formatDuration(metrics.responseTime.ttrMedianMs)}
              sublabel={`p90 ${formatDuration(metrics.responseTime.ttrP90Ms)}`}
            />
            <Metric
              label="Procedure-driven"
              value={formatPercent(metrics.resolution.procedureRate)}
              sublabel="of resolved"
            />
            <Metric
              label="Follow-ups"
              value={formatPercent(metrics.followUpRate)}
              sublabel="of created"
            />
          </div>
          {honest && <HonestResolutionCard data={honest} />}
          {statement && <OutcomeStatementCard data={statement} />}
          {health && <KnowledgeHealthCard data={health} />}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Volume by channel
            </div>
            <ChannelBars data={metrics.volume.byChannel} total={metrics.volume.total} />
          </div>
        </>
      )}
    </section>
  );
}

function ChannelBars({ data, total }: { data: { kind: string; count: number }[]; total: number }) {
  if (data.length === 0) {
    return <div className="muted">No tickets in this window.</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {data.map((row) => {
        const pct = total ? (row.count / total) * 100 : 0;
        return (
          <div
            key={row.kind}
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr 60px',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12 }}>{labelForKind(row.kind)}</span>
            <div
              style={{
                background: '#e2e8f0',
                borderRadius: 4,
                overflow: 'hidden',
                height: 10,
              }}
            >
              <div
                style={{
                  width: `${pct.toFixed(1)}%`,
                  background: '#0f172a',
                  height: '100%',
                }}
              />
            </div>
            <span style={{ fontSize: 12, textAlign: 'right', color: '#475569' }}>{row.count}</span>
          </div>
        );
      })}
    </div>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  chat: 'Chat',
  form: 'Form',
  sms: 'SMS',
  slack: 'Slack',
  discord: 'Discord',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  teams: 'Teams',
  messenger: 'Messenger',
  instagram: 'Instagram',
  rcs: 'RCS',
  apple_business: 'Apple Business',
  webhook: 'Webhook',
  voice: 'Voice',
};

function labelForKind(kind: string): string {
  return CHANNEL_LABELS[kind] ?? kind;
}
