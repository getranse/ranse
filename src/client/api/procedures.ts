import type {
  ProcedureLibraryDetail,
  ProcedureLibraryListEntry,
  ProcedureListEntry,
} from '../../types/client/procedures';
import type {
  ProcedureListItem,
  ProcedureRun,
  ProcedureRunDetail,
  ProcedureSpec,
} from '../../types/shared/procedures';
import { api } from './core';

export const procedureApi = {
  listProcedures: () => api<{ procedures: ProcedureListEntry[] }>('/api/procedures'),
  listProcedureLibrary: () =>
    api<{ procedures: ProcedureLibraryListEntry[] }>('/api/procedures/library'),
  procedureLibraryItem: (slug: string) =>
    api<{ procedure: ProcedureLibraryDetail }>(`/api/procedures/library/${slug}`),
  installProcedureLibraryItem: (slug: string) =>
    api<{ procedure: ProcedureListItem; version: unknown; created: boolean }>(
      `/api/procedures/library/${slug}/install`,
      {
        method: 'POST',
      },
    ),
  procedure: (id: string) =>
    api<{
      procedure: ProcedureListItem;
      version: unknown;
      spec: ProcedureSpec;
    }>(`/api/procedures/${id}`),
  publishProcedure: (spec: ProcedureSpec) =>
    api('/api/procedures', { method: 'POST', body: JSON.stringify({ spec }) }),
  startProcedureRun: (procedureId: string, ticketId: string, context?: Record<string, unknown>) =>
    api<{ run: ProcedureRun }>(`/api/procedures/${procedureId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ ticket_id: ticketId, context }),
    }),
  procedureRun: (runId: string) => api<ProcedureRunDetail>(`/api/procedure-runs/${runId}`),
  resumeProcedureRun: (
    runId: string,
    event: 'customer_reply' | 'approval_decided' | 'manual_resume',
    payload?: Record<string, unknown>,
  ) =>
    api<ProcedureRunDetail>(`/api/procedure-runs/${runId}/resume`, {
      method: 'POST',
      body: JSON.stringify({ event, payload }),
    }),
  cancelProcedureRun: (runId: string) =>
    api<{ ok: boolean }>(`/api/procedure-runs/${runId}/cancel`, { method: 'POST' }),
};
