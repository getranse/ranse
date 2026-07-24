import { formatCents, formatPercent } from '../../../lib/format';
import type {
  HonestResolutionResponse,
  KnowledgeHealthResponse,
  OutcomeStatementResponse,
} from '../../api';
import { Metric } from './Metric';

export function KnowledgeHealthCard({ data }: { data: KnowledgeHealthResponse }) {
  const gradeColor: Record<KnowledgeHealthResponse['grade'], string> = {
    A: '#16a34a',
    B: '#65a30d',
    C: '#ca8a04',
    D: '#ea580c',
    F: '#dc2626',
  };
  return (
    <div className="card" style={{ marginTop: 12, padding: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Knowledge health</div>
        <div className="muted" style={{ fontSize: 11 }}>
          stale = silently kills resolution rate
        </div>
      </div>
      <div className="insight-grid">
        <Metric
          label="Grade"
          value={data.grade}
          sublabel={`avg ${(data.averageStaleness * 100).toFixed(0)}% stale`}
        />
        <Metric
          label="Stale sources"
          value={`${data.staleSourceCount} / ${data.totalSourceCount}`}
          sublabel="staleness ≥ 0.6"
        />
        <Metric
          label="Cited recently"
          value={String(data.staleCitedRecently)}
          sublabel="stale + cited last 30d"
        />
      </div>
      {data.topStaleSources.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>
            Top stale:
          </div>
          {data.topStaleSources.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: gradeColor[data.grade] }}>•</span>
              <span>{s.title}</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {(s.staleness_score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OutcomeStatementCard({ data }: { data: OutcomeStatementResponse }) {
  const finCompare =
    data.finComparisonCents > 0
      ? `${formatCents(data.finComparisonCents, data.currency)} on Fin's $0.99 model`
      : '—';
  return (
    <div className="card" style={{ marginTop: 12, padding: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Outcome statement</div>
        <div className="muted" style={{ fontSize: 11 }}>
          last {data.windowDays} days · {data.currency}
        </div>
      </div>
      <div className="insight-grid">
        <Metric
          label="Value delivered"
          value={formatCents(data.valueCents, data.currency)}
          sublabel={`${data.verifiedResolutionCount} verified`}
        />
        <Metric
          label="Cost"
          value={formatCents(data.costCents, data.currency)}
          sublabel="from rejections + escalations"
        />
        <Metric
          label="Net"
          value={formatCents(data.netCents, data.currency)}
          sublabel={data.roiRatio ? `${data.roiRatio.toFixed(1)}× ROI` : '—'}
        />
        <Metric
          label="Cost / verified"
          value={
            data.costPerVerifiedResolution !== null
              ? formatCents(Math.round(data.costPerVerifiedResolution), data.currency)
              : '—'
          }
          sublabel={`vs. ${finCompare}`}
        />
      </div>
    </div>
  );
}

export function HonestResolutionCard({ data }: { data: HonestResolutionResponse }) {
  const gap = data.finStyleRate - data.honestResolutionRate;
  return (
    <div className="card" style={{ marginTop: 12, padding: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Honest Resolution</div>
        <div className="muted" style={{ fontSize: 11 }}>
          customer-confirmed · no human takeover · no follow-up
        </div>
      </div>
      <div className="insight-grid">
        <Metric
          label="Honest rate"
          value={formatPercent(data.honestResolutionRate)}
          sublabel={`${data.verifiedCount} verified`}
        />
        <Metric
          label="Industry rate"
          value={formatPercent(data.finStyleRate)}
          sublabel={`${gap > 0 ? `+${formatPercent(gap)} inflated` : 'aligned'}`}
        />
        <Metric
          label="Pending"
          value={String(data.pendingCount)}
          sublabel="awaiting window close"
        />
        <Metric label="Rejected" value={String(data.rejectedCount)} sublabel="see breakdown" />
      </div>
      {data.rejectedCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
          Rejection breakdown:&nbsp;
          {(
            [
              ['human_takeover', 'human takeover'],
              ['follow_up', 'follow-up'],
              ['negative_feedback', 'negative feedback'],
              ['escalated', 'escalated'],
              ['reopened', 'reopened'],
            ] as const
          )
            .filter(([k]) => data.rejectionBreakdown[k] > 0)
            .map(([k, label]) => `${label} ${data.rejectionBreakdown[k]}`)
            .join(' · ')}
        </div>
      )}
    </div>
  );
}
