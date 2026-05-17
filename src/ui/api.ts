import type {
  AgenticRetrievalTrace,
  KnowledgeHit,
  KnowledgeInspectionHit,
  KnowledgeSourceListItem,
} from '../types/knowledge';
import type { AuthMe } from '../types/workspace';
import { api, uploadFile, uploadKnowledgePdf } from './api-core';
import { workspaceApi } from './api-workspaces';

export { ApiRequestError, api } from './api-core';

export type KnowledgeSource = KnowledgeSourceListItem;
export type KnowledgeSearchHit = KnowledgeHit;
export type AnswerInspectionHit = KnowledgeInspectionHit;
export type AnswerInspectionTrace = AgenticRetrievalTrace;

export const API = {
  setupStatus: () => api<{ completed: boolean }>('/setup/status'),
  bootstrap: (body: any) => api('/setup/bootstrap', { method: 'POST', body: JSON.stringify(body) }),
  addMailbox: (body: any) => api('/setup/mailbox', { method: 'POST', body: JSON.stringify(body) }),
  provision: (body: {
    api_token: string;
    account_id: string;
    domain: string;
    mailbox_address: string;
    worker_name: string;
  }) =>
    api<{ ok: boolean; steps: any[] }>('/setup/provision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  verify: () => api('/setup/verify', { method: 'POST' }),
  login: (email: string, password: string) =>
    api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  me: () => api<AuthMe>('/auth/me'),
  ...workspaceApi,
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
  draftWithAI: (id: string) =>
    api<{
      ok: boolean;
      subject?: string;
      body?: string;
      knowledge?: AnswerInspectionHit[];
      knowledgeTrace?: AnswerInspectionTrace;
      error?: string;
    }>(`/api/tickets/${id}/draft`, { method: 'POST' }),
  setTicketAiDrafts: (id: string, enabled: boolean | null) =>
    api(`/api/tickets/${id}/ai-drafts`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  myProfile: () =>
    api<{ name: string; email: string; signature_markdown: string; avatar_url: string }>(
      '/api/me/profile',
    ),
  setMyProfile: (profile: { name?: string; signature_markdown?: string; avatar_url?: string }) =>
    api('/api/me/profile', { method: 'POST', body: JSON.stringify(profile) }),
  uploadAvatar: (file: File) => uploadFile('/api/uploads/avatar', file),
  notificationsMeta: () =>
    api<{
      events: { name: string; description: string }[];
      channels: {
        kind: string;
        label: string;
        description: string;
        targetLabel: string;
        targetPlaceholder: string;
      }[];
    }>('/api/notifications/meta'),
  listNotificationChannels: () =>
    api<{
      channels: {
        id: string;
        kind: string;
        target: string;
        events: string[];
        enabled: boolean;
        label: string | null;
        created_at: number;
      }[];
    }>('/api/notifications/channels'),
  createNotificationChannel: (body: {
    kind: string;
    target: string;
    events: string[];
    label?: string;
  }) =>
    api<{ ok: boolean; id: string }>('/api/notifications/channels', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateNotificationChannel: (
    id: string,
    body: { enabled?: boolean; events?: string[]; label?: string | null },
  ) => api(`/api/notifications/channels/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNotificationChannel: (id: string) =>
    api(`/api/notifications/channels/${id}`, { method: 'DELETE' }),
  testNotificationChannel: (id: string) =>
    api<{ ok: boolean }>(`/api/notifications/channels/${id}/test`, { method: 'POST' }),
  approve: (id: string, edits?: any) =>
    api(`/api/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ edits }) }),
  reject: (id: string, reason?: string) =>
    api(`/api/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  listKnowledge: () =>
    api<{
      sources: KnowledgeSource[];
    }>('/api/knowledge'),
  createKnowledge: (body: {
    kind: 'manual' | 'url';
    title?: string;
    body?: string;
    url?: string;
  }) =>
    api<{ ok: boolean; id: string; chunks: number; vectorized: boolean }>('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadKnowledgePdf,
  reindexKnowledge: (id: string) =>
    api<{ ok: boolean; id: string; chunks: number; vectorized: boolean }>(
      `/api/knowledge/${id}/reindex`,
      { method: 'POST' },
    ),
  searchKnowledge: (query: string, limit = 5) =>
    api<{
      hits: KnowledgeSearchHit[];
      trace?: AnswerInspectionTrace;
    }>('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ query, limit }) }),
  importResolvedTicketsKnowledge: (limit = 50) =>
    api<{ ok: boolean; imported: number; skipped: number; failed: number }>(
      '/api/knowledge/import-resolved-tickets',
      {
        method: 'POST',
        body: JSON.stringify({ limit }),
      },
    ),
  llmConfig: () => api<any>('/api/settings/llm'),
  setLlmConfig: (body: any) =>
    api('/api/settings/llm', { method: 'POST', body: JSON.stringify(body) }),
  providers: () => api<{ providers: string[] }>('/api/settings/providers'),
  setProvider: (provider: string, api_key: string) =>
    api('/api/settings/providers', { method: 'POST', body: JSON.stringify({ provider, api_key }) }),
};
