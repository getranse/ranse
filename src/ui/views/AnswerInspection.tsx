import type { AnswerInspectionHit, AnswerInspectionTrace } from '../api';

export function AnswerInspection({
  hits,
  trace,
}: {
  hits?: AnswerInspectionHit[];
  trace?: AnswerInspectionTrace;
}) {
  if ((!hits || hits.length === 0) && !trace) return null;
  return (
    <details className="answer-inspection">
      <summary>Answer inspection</summary>
      {trace && (
        <div className="inspection-trace">
          <div className="muted">
            {trace.plan.scope} · {trace.hops.length}/{trace.plan.maxHops} hops · {trace.stopReason}
            {typeof trace.durationMs === 'number' ? ` · ${trace.durationMs}ms` : ''}
            {trace.plan.source ? ` · plan ${trace.plan.source}` : ''}
          </div>
          {trace.hops.map((hop) => (
            <div key={`${hop.hop}-${hop.query}`} className="inspection-hop">
              <strong>Hop {hop.hop}</strong>
              <div>{hop.query}</div>
              <div className="muted">
                {hop.hits.length} hits · {hop.judgment.sufficient ? 'sufficient' : 'needs more'}
                {typeof hop.accumulatedHitCount === 'number'
                  ? ` · ${hop.accumulatedHitCount} accumulated`
                  : ''}
                {typeof hop.searchMs === 'number' ? ` · search ${hop.searchMs}ms` : ''}
                {typeof hop.judgeMs === 'number' ? ` · judge ${hop.judgeMs}ms` : ''}
                {hop.judgment.source ? ` · ${hop.judgment.source}` : ''}
              </div>
              {hop.judgment.reasoning && <div>{hop.judgment.reasoning}</div>}
              {hop.judgment.nextQuery && (
                <div className="muted">Next: {hop.judgment.nextQuery}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {hits?.map((hit) => (
        <div key={hit.id} className="inspection-hit">
          <div>
            <strong>{hit.title}</strong>
            {hit.cited && (
              <span className="pill resolved" style={{ marginLeft: 6 }}>
                cited
              </span>
            )}
          </div>
          <div className="muted">
            {hit.sourceKind ? `${hit.sourceKind} · ` : ''}score {Number(hit.score ?? 0).toFixed(3)}
          </div>
          <div>{hit.snippet}</div>
          {hit.url && (
            <a href={hit.url} target="_blank" rel="noreferrer">
              {hit.url}
            </a>
          )}
        </div>
      ))}
    </details>
  );
}
