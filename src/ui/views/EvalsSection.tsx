import { useEffect, useState } from 'react';
import { API, type EvalCaseEntry, type EvalRunEntry } from '../api';

interface EvalsSectionProps {
  onSaved: (message?: string) => void;
}

export function EvalsSection({ onSaved }: EvalsSectionProps) {
  const [cases, setCases] = useState<EvalCaseEntry[]>([]);
  const [runs, setRuns] = useState<EvalRunEntry[]>([]);
  const [limit, setLimit] = useState(50);
  const [threshold, setThreshold] = useState(0.35);
  const [scoreDropThreshold, setScoreDropThreshold] = useState(0.15);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [caseRes, runRes] = await Promise.all([API.listEvalCases(), API.listEvalRuns()]);
    setCases(caseRes.cases ?? []);
    setRuns(runRes.runs ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Failed to load evals'));
  }, []);

  async function capture() {
    setError('');
    setBusy('capture');
    try {
      const result = await API.captureResolvedEvalCases(limit);
      await load();
      onSaved(`Captured ${result.captured} eval cases`);
    } catch (err: any) {
      setError(err.message || 'Capture failed');
    } finally {
      setBusy('');
    }
  }

  async function run() {
    setError('');
    setBusy('run');
    try {
      const detail = await API.runEvalSuite({
        limit,
        threshold,
        score_drop_threshold: scoreDropThreshold,
      });
      await load();
      onSaved(`Eval run ${detail.run.status}`);
    } catch (err: any) {
      setError(err.message || 'Eval run failed');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <h2>Evals</h2>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, minWidth: 120 }}>
            <label>Case limit</label>
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 140 }}>
            <label>Pass threshold</label>
            <input
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 150 }}>
            <label>Regression drop</label>
            <input
              type="number"
              min={0.01}
              max={0.75}
              step={0.01}
              value={scoreDropThreshold}
              onChange={(e) => setScoreDropThreshold(Number(e.target.value))}
            />
          </div>
          <button disabled={busy === 'capture'} onClick={capture}>
            {busy === 'capture' ? 'Capturing...' : 'Capture resolved'}
          </button>
          <button className="primary" disabled={busy === 'run' || cases.length === 0} onClick={run}>
            {busy === 'run' ? 'Running...' : 'Run evals'}
          </button>
        </div>

        {error && (
          <div className="error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}

        <div className="source-list" style={{ marginTop: 16 }}>
          <div className="source-row">
            <div>
              <div style={{ fontWeight: 500 }}>Historical cases</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {cases.length} active replay cases from resolved conversations
              </div>
            </div>
            <span className="pill">{cases.length}</span>
          </div>
          {cases.slice(0, 5).map((evalCase) => (
            <div className="source-row" key={evalCase.id}>
              <div>
                <div style={{ fontWeight: 500 }}>{evalCase.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {evalCase.source} · {new Date(evalCase.captured_at).toLocaleString()}
                </div>
              </div>
              <button
                disabled={busy === `archive:${evalCase.id}`}
                onClick={async () => {
                  setBusy(`archive:${evalCase.id}`);
                  try {
                    await API.updateEvalCase(evalCase.id, 'archived');
                    await load();
                    onSaved('Eval case archived');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Archive
              </button>
            </div>
          ))}
          {runs.slice(0, 5).map((runItem) => (
            <div className="source-row" key={runItem.id}>
              <div>
                <div style={{ fontWeight: 500 }}>
                  {runItem.status} · {runItem.passed_count}/{runItem.case_count} passed
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(runItem.created_at).toLocaleString()} · {runItem.regression_count}{' '}
                  regressions
                </div>
              </div>
              <span className={`pill ${runItem.status === 'passed' ? 'resolved' : ''}`}>
                {runItem.source}
              </span>
            </div>
          ))}
          {runs.length === 0 && <div className="muted">No eval runs yet.</div>}
        </div>
      </div>
    </>
  );
}
