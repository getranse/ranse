import type { EvalRunDetail } from '../../types/shared/evals';
import type { EvalCaseEntry, EvalRunEntry } from '../../types/client/evals';
import { api } from './core';

export const evalApi = {
  listEvalCases: () => api<{ cases: EvalCaseEntry[] }>('/api/evals/cases'),
  listEvalRuns: () => api<{ runs: EvalRunEntry[] }>('/api/evals/runs'),
  updateEvalCase: (id: string, status: 'active' | 'archived') =>
    api<{ case: EvalCaseEntry }>(`/api/evals/cases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  captureResolvedEvalCases: (limit = 50) =>
    api<{ ok: boolean; captured: number; skipped: number; failed: number; cases: string[] }>(
      '/api/evals/cases/capture-resolved',
      {
        method: 'POST',
        body: JSON.stringify({ limit }),
      },
    ),
  runEvalSuite: (
    body: { limit?: number; threshold?: number; score_drop_threshold?: number } = {},
  ) =>
    api<EvalRunDetail>('/api/evals/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
