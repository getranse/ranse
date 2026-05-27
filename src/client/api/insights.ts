import type { KbSuggestionStatus, KnowledgeDriftStatus } from '../../types/insights';
import type {
  ConversationScoreEntry,
  HonestResolutionResponse,
  InsightSummaryEntry,
  KbSuggestionEntry,
  KnowledgeDriftSignalEntry,
  KnowledgeHealthResponse,
  OperationsMetricsResponse,
  ProactiveProposalResponse,
} from '../types/insights';
import { api } from './core';

export const insightApi = {
  insightSummary: (days = 30) =>
    api<{ summary: InsightSummaryEntry }>(`/api/insights/summary?days=${days}`),
  operationsMetrics: (days = 30) =>
    api<{ metrics: OperationsMetricsResponse }>(`/api/insights/operations?days=${days}`),
  honestResolution: (days = 30) =>
    api<{ metrics: HonestResolutionResponse }>(`/api/insights/honest-resolution?days=${days}`),
  knowledgeHealth: () => api<{ health: KnowledgeHealthResponse }>(`/api/insights/knowledge-health`),
  proposals: (status?: string) =>
    api<{ proposals: ProactiveProposalResponse[] }>(
      status ? `/api/insights/proposals?status=${status}` : `/api/insights/proposals`,
    ),
  runProposals: () =>
    api<{ examined: number; drafted: number; auto_rejected: number; proposalIds: string[] }>(
      '/api/insights/proposals/run',
      { method: 'POST' },
    ),
  acceptProposal: (id: string) =>
    api<{ proposal: ProactiveProposalResponse }>(`/api/insights/proposals/${id}/accept`, {
      method: 'POST',
    }),
  rejectProposal: (id: string, reason: string) =>
    api<{ proposal: ProactiveProposalResponse }>(`/api/insights/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  listConversationScores: (limit = 50) =>
    api<{ scores: ConversationScoreEntry[] }>(`/api/insights/scores?limit=${limit}`),
  runConversationScoring: (limit = 100) =>
    api<{ scored: number; scores: ConversationScoreEntry[] }>('/api/insights/scores/run', {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),
  listKbSuggestions: (status: KbSuggestionStatus = 'open') =>
    api<{ suggestions: KbSuggestionEntry[] }>(`/api/insights/kb-suggestions?status=${status}`),
  generateKbSuggestions: (limit = 100) =>
    api<{ generated: number; suggestions: KbSuggestionEntry[] }>(
      '/api/insights/kb-suggestions/run',
      {
        method: 'POST',
        body: JSON.stringify({ limit }),
      },
    ),
  updateKbSuggestion: (id: string, status: Exclude<KbSuggestionStatus, 'accepted'>) =>
    api<{ suggestion: KbSuggestionEntry }>(`/api/insights/kb-suggestions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  acceptKbSuggestion: (id: string) =>
    api<{ suggestion: KbSuggestionEntry; sourceId: string }>(
      `/api/insights/kb-suggestions/${id}/accept`,
      { method: 'POST' },
    ),
  listKnowledgeDrift: (status: KnowledgeDriftStatus = 'open') =>
    api<{ signals: KnowledgeDriftSignalEntry[] }>(`/api/insights/drift?status=${status}`),
  runKnowledgeDrift: () =>
    api<{ detected: number; signals: KnowledgeDriftSignalEntry[] }>('/api/insights/drift/run', {
      method: 'POST',
    }),
  updateKnowledgeDrift: (id: string, status: KnowledgeDriftStatus) =>
    api<{ signal: KnowledgeDriftSignalEntry }>(`/api/insights/drift/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
