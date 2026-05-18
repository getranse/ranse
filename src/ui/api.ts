import type {
  AgenticRetrievalTrace,
  KnowledgeHit,
  KnowledgeInspectionHit,
  KnowledgeSourceListItem,
} from '../types/knowledge';
import type {
  ProcedureLibraryItem,
  ProcedureLibraryEntry,
  ProcedureListItem,
  ProcedureRun,
  ProcedureRunDetail,
  ProcedureSpec,
} from '../types/procedure';
import type { McpServerListItem, McpTool, McpToolCall, McpToolGuardrail } from '../types/mcp';
import type { AuthMe } from '../types/workspace';
import type { EvalCase, EvalRun, EvalRunDetail } from '../types/evals';
import { api, uploadFile, uploadKnowledgePdf } from './api-core';
import { workspaceApi } from './api-workspaces';

export { ApiRequestError, api } from './api-core';

export type KnowledgeSource = KnowledgeSourceListItem;
export type KnowledgeSearchHit = KnowledgeHit;
export type AnswerInspectionHit = KnowledgeInspectionHit;
export type AnswerInspectionTrace = AgenticRetrievalTrace;
export type ProcedureListEntry = ProcedureListItem;
export type ProcedureLibraryListEntry = ProcedureLibraryEntry;
export type ProcedureLibraryDetail = ProcedureLibraryItem;
export type McpServerEntry = McpServerListItem;
export type McpToolEntry = McpTool;
export type EvalCaseEntry = EvalCase;
export type EvalRunEntry = EvalRun;

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
  recordTicketFeedback: (id: string, rating: 'positive' | 'negative', messageId?: string) =>
    api<{ ok: boolean; feedbackId?: string }>(`/api/tickets/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating, message_id: messageId ?? null }),
    }),
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
  mcpCatalog: () =>
    api<{
      templates: Array<{
        id: string;
        name: string;
        label: string;
        description: string;
        expectedTools: string[];
        authType: 'bearer' | 'header';
        authHeaderName?: string;
        endpointPlaceholder: string;
      }>;
    }>('/api/mcp/catalog'),
  listMcpServers: () => api<{ servers: McpServerEntry[] }>('/api/mcp/servers'),
  createMcpServer: (body: {
    name: string;
    endpoint_url: string;
    auth_type: 'none' | 'bearer' | 'header';
    auth_header_name?: string | null;
    auth_secret?: string;
    enabled?: boolean;
  }) =>
    api<{ server: McpServerEntry }>('/api/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMcpServer: (
    id: string,
    body: {
      name?: string;
      endpoint_url?: string;
      auth_type?: 'none' | 'bearer' | 'header';
      auth_header_name?: string | null;
      auth_secret?: string;
      enabled?: boolean;
    },
  ) =>
    api<{ server: McpServerEntry }>(`/api/mcp/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteMcpServer: (id: string) =>
    api<{ ok: boolean }>(`/api/mcp/servers/${id}`, { method: 'DELETE' }),
  discoverMcpTools: (serverId: string) =>
    api<{ ok: boolean; tools: McpToolEntry[] }>(`/api/mcp/servers/${serverId}/discover`, {
      method: 'POST',
    }),
  listMcpTools: (serverId?: string) =>
    api<{ tools: McpToolEntry[] }>(`/api/mcp/tools${serverId ? `?server_id=${serverId}` : ''}`),
  setMcpGuardrail: (
    serverId: string,
    body: {
      tool_name: string;
      enabled?: boolean;
      requires_approval?: boolean | null;
      max_calls_per_ticket?: number | null;
      max_calls_per_hour?: number | null;
      dollar_limit_cents?: number | null;
      allowed_customer_segments?: string[];
    },
  ) =>
    api<{ guardrail: McpToolGuardrail }>(`/api/mcp/servers/${serverId}/guardrails`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMcpToolCalls: (ticketId: string) =>
    api<{ toolCalls: McpToolCall[] }>(`/api/mcp/tool-calls?ticket_id=${ticketId}`),
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
