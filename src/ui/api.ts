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
import type {
  ConversationScore,
  InsightSummary,
  KbSuggestion,
  KbSuggestionStatus,
  KnowledgeDriftSignal,
  KnowledgeDriftStatus,
} from '../types/insights';
import type { PublicChannel, PublicChannelKind } from '../types/channels';
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
export type ConversationScoreEntry = ConversationScore;
export type InsightSummaryEntry = InsightSummary;

export interface OnboardingStep {
  id: 'ingest_knowledge' | 'connect_channel' | 'first_reply';
  label: string;
  description: string;
  done: boolean;
  action: { kind: 'navigate'; href: string; label: string };
}

export interface OnboardingStateResponse {
  steps: OnboardingStep[];
  completedCount: number;
  dismissed: boolean;
  shouldShow: boolean;
}

export interface CustomerMemoryEntry {
  id: string;
  customer_id: string;
  kind: string;
  fact_text: string;
  confidence: number;
  source_ticket_id: string | null;
  created_by: string;
  redacted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OperationsMetricsResponse {
  windowStart: number;
  windowEnd: number;
  volume: { total: number; byChannel: { kind: string; count: number }[] };
  resolution: { rate: number; autonomousRate: number; procedureRate: number };
  deflection: { rate: number; autonomousResolved: number; humanResolved: number };
  responseTime: {
    ttfrMedianMs: number | null;
    ttfrP90Ms: number | null;
    ttrMedianMs: number | null;
    ttrP90Ms: number | null;
  };
  satisfaction: { csatScore: number | null; positiveCount: number; negativeCount: number };
  followUpRate: number;
}

export interface OutcomeStatementResponse {
  windowDays: number;
  windowStart: number;
  windowEnd: number;
  currency: string;
  valueCents: number;
  costCents: number;
  netCents: number;
  costPerVerifiedResolution: number | null;
  verifiedResolutionCount: number;
  finComparisonCents: number;
  roiRatio: number | null;
  breakdown: { kind: string; amountCents: number; count: number }[];
}

export interface PricingResponse {
  currency: string;
  inferenceCostCentsPer1kTokens: number;
  priceBook: {
    verified_resolution: number;
    autonomous_resolution: number;
    procedure_resolution: number;
    escalation: number;
    follow_up_cost: number;
    human_takeover_cost: number;
    inference_cost: number;
  };
  defaults: PricingResponse['priceBook'];
  updatedAt: number;
}

export interface KnowledgeHealthResponse {
  averageStaleness: number;
  staleSourceCount: number;
  totalSourceCount: number;
  staleCitedRecently: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  topStaleSources: {
    id: string;
    title: string;
    staleness_score: number;
    last_crawled_at: number | null;
  }[];
}

export interface ProactiveProposalResponse {
  id: string;
  workspace_id: string;
  cluster_key: string;
  kind: 'procedure' | 'knowledge' | 'combined';
  draft_procedure_spec_json: string | null;
  draft_knowledge_entry_json: string | null;
  eval_pass_rate: number | null;
  eval_case_count: number;
  status: 'pending' | 'accepted' | 'rejected' | 'auto_rejected';
  rejected_reason: string | null;
  proposed_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  applied_procedure_id: string | null;
  applied_knowledge_source_id: string | null;
  summary: string | null;
  evidence_ticket_ids_json: string | null;
}

export interface HonestResolutionResponse {
  windowDays: number;
  windowStart: number;
  windowEnd: number;
  aiAuthoredCount: number;
  verifiedCount: number;
  pendingCount: number;
  rejectedCount: number;
  rejectionBreakdown: {
    human_takeover: number;
    escalated: number;
    follow_up: number;
    negative_feedback: number;
    reopened: number;
  };
  honestResolutionRate: number;
  finStyleRate: number;
}

export type KbSuggestionEntry = KbSuggestion;
export type KnowledgeDriftSignalEntry = KnowledgeDriftSignal;
export type PublicChannelEntry = PublicChannel;

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
  draftAssist: (id: string, draft: string, cursor?: number) =>
    api<{
      completion: string;
      confidence: number;
      knowledge: { id: string; title: string; url?: string; snippet?: string }[];
      similar: { id: string; subject: string; resolved_at: number | null; preview: string | null }[];
      model: string;
    }>(`/api/tickets/${id}/draft-assist`, {
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
  listPublicChannels: () => api<{ channels: PublicChannelEntry[] }>('/api/channels/public'),
  createPublicChannel: (body: {
    kind: PublicChannelKind;
    mailbox_id: string;
    name: string;
    enabled?: boolean;
    require_email?: boolean;
    allowed_origins?: string[];
    welcome_message?: string | null;
    config?: Record<string, unknown>;
    sla_first_response_minutes?: number | null;
    sla_resolution_minutes?: number | null;
    default_priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
    default_assignee_user_id?: string | null;
  }) =>
    api<{ channel: PublicChannelEntry }>('/api/channels/public', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePublicChannel: (
    id: string,
    body: {
      name?: string;
      enabled?: boolean;
      require_email?: boolean;
      allowed_origins?: string[];
      welcome_message?: string | null;
      config?: Record<string, unknown>;
      sla_first_response_minutes?: number | null;
      sla_resolution_minutes?: number | null;
      default_priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
      default_assignee_user_id?: string | null;
    },
  ) =>
    api<{ channel: PublicChannelEntry }>(`/api/channels/public/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
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
  insightSummary: (days = 30) =>
    api<{ summary: InsightSummaryEntry }>(`/api/insights/summary?days=${days}`),
  onboardingState: () => api<OnboardingStateResponse>('/api/onboarding'),
  dismissOnboarding: () => api<{ ok: boolean }>('/api/onboarding/dismiss', { method: 'POST' }),
  operationsMetrics: (days = 30) =>
    api<{ metrics: OperationsMetricsResponse }>(`/api/insights/operations?days=${days}`),
  honestResolution: (days = 30) =>
    api<{ metrics: HonestResolutionResponse }>(`/api/insights/honest-resolution?days=${days}`),
  outcomeStatement: (days = 30) =>
    api<{ statement: OutcomeStatementResponse }>(`/api/billing/statement?days=${days}`),
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
  pricing: () => api<{ pricing: PricingResponse }>('/api/billing/pricing'),
  updatePricing: (body: Partial<{
    priceBook: Partial<PricingResponse['priceBook']>;
    inferenceCostCentsPer1kTokens: number;
    currency: string;
  }>) =>
    api<{ pricing: PricingResponse }>('/api/billing/pricing', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listCustomerMemory: (customerId: string) =>
    api<{ memory: CustomerMemoryEntry[] }>(`/api/memory/customers/${customerId}`),
  addCustomerMemory: (
    customerId: string,
    body: { fact_text: string; kind?: string; confidence?: number },
  ) =>
    api<{ memory: CustomerMemoryEntry }>(`/api/memory/customers/${customerId}`, {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, ...body }),
    }),
  redactCustomerMemory: (customerId: string, memoryId: string, reason: string) =>
    api(`/api/memory/customers/${customerId}/redact/${memoryId}`, {
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
