import { useEffect, useState } from 'react';
import { API, type OperationsMetricsResponse } from '../api';

// Operations dashboard. Renders the metrics computeOperationsMetrics
// returns: ticket volume per channel, resolution mix, deflection rate,
// time-to-first-response + time-to-resolution percentiles, CSAT, and
// follow-up rate. The window selector (7/30/90 days) re-fetches.

const WINDOW_OPTIONS = [7, 30, 90];

export function OperationsDashboard() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<OperationsMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    API.operationsMetrics(days)
      .then((res) => setMetrics(res.metrics))
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

function Metric({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
        {value}
      </div>
      {sublabel && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {sublabel}
        </div>
      )}
    </div>
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

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

function labelForKind(kind: string): string {
  if (kind === 'email') return 'Email';
  if (kind === 'chat') return 'Chat';
  if (kind === 'form') return 'Form';
  if (kind === 'sms') return 'SMS';
  if (kind === 'slack') return 'Slack';
  if (kind === 'discord') return 'Discord';
  if (kind === 'telegram') return 'Telegram';
  if (kind === 'whatsapp') return 'WhatsApp';
  if (kind === 'teams') return 'Teams';
  if (kind === 'messenger') return 'Messenger';
  if (kind === 'instagram') return 'Instagram';
  if (kind === 'rcs') return 'RCS';
  if (kind === 'apple_business') return 'Apple Business';
  if (kind === 'webhook') return 'Webhook';
  if (kind === 'voice') return 'Voice';
  return kind;
}
