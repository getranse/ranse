import type { DraftAssistResult, TicketDraft } from '../../types/client/tickets';
import { api } from './core';

export const ticketApi = {
  tickets: (status?: string) => api<any>(`/api/tickets${status ? `?status=${status}` : ''}`),
  ticket: <T = any>(id: string) => api<T>(`/api/tickets/${id}`),
  setStatus: (id: string, status: string) =>
    api(`/api/tickets/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  addNote: (id: string, body: string) =>
    api(`/api/tickets/${id}/note`, { method: 'POST', body: JSON.stringify({ body }) }),
  reply: (id: string, body: string, subject?: string, citedKnowledgeIds?: string[]) =>
    api<{ ok: boolean; messageId?: string; error?: string }>(`/api/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body, subject, cited_knowledge_ids: citedKnowledgeIds }),
    }),
  draftWithAI: (id: string) => api<TicketDraft>(`/api/tickets/${id}/draft`, { method: 'POST' }),
  draftAssist: (id: string, draft: string, cursor?: number) =>
    api<DraftAssistResult>(`/api/tickets/${id}/draft-assist`, {
      method: 'POST',
      body: JSON.stringify({ draft, cursor }),
    }),
  setTicketAiDrafts: (id: string, enabled: boolean | null) =>
    api(`/api/tickets/${id}/ai-drafts`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  recordTicketFeedback: (id: string, rating: 'positive' | 'negative', messageId?: string) =>
    api<{ ok: boolean; feedbackId?: string }>(`/api/tickets/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating, message_id: messageId ?? null }),
    }),
};
