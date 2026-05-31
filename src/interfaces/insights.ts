import type { VerifiedResolutionSource } from '../types/shared/honest-resolution';
import type { ProactiveProposalDraft, ProactiveProposalKind, ProactiveProposalStatus } from '../types/shared/proactive';
import type { KbSuggestionStatus, KnowledgeDriftStatus, KnowledgeDriftSeverity } from '../types/shared/insights';

// Honest Resolution — the verified_resolution lifecycle.
//
// An AI-authored reply (autonomous or procedure) opens a 7-day verification
// window. Anything that contradicts a clean resolution — a human takeover,
// an escalation, a customer follow-up, or a negative feedback signal — moves
// the row to `rejected` with a reason. After the window closes with no
// rejection, the sweeper promotes it to `verified`.
//
// One row per ticket. A re-opened ticket needs another AI reply to start a
// new window (the UNIQUE constraint enforces this and the enqueue path is a
// no-op when a row already exists).

export interface EnqueueArgs {
  workspaceId: string;
  ticketId: string;
  aiMessageId: string;
  source: VerifiedResolutionSource;
  authoredAt?: number;
  payload?: Record<string, unknown>;
}

export interface SweepResult {
  examined: number;
  verified: number;
}

export interface TicketRow {
  id: string;
  workspace_id: string;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  requester_email: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  ticket_id: string;
  workspace_id: string;
  direction: 'inbound' | 'outbound' | 'note';
  preview: string | null;
  sent_at: number;
  created_at: number;
}

export interface ApprovalRow {
  kind: string;
  status: string;
  proposed_json: string;
  risk_reasons_json: string;
  created_at: number;
}

export interface OutcomeRow {
  kind: string;
  confidence_score: number | null;
  payload_json: string;
  created_at: number;
}

export interface FeedbackRow {
  rating: 'positive' | 'negative';
  source: string;
  comment: string | null;
  created_at: number;
}

// Operations dashboard. Aggregates the metrics that day-to-day support
// managers actually look at: resolution rate, AI deflection rate, time-
// to-first-response, time-to-resolution, customer satisfaction, ticket
// volume by channel. All derived from existing tables — no new ingest
// pipeline. Computed on demand; for very large workspaces a future
// enhancement can roll these into the existing weekly maintenance job.

export interface OperationsMetrics {
  windowStart: number;
  windowEnd: number;
  volume: { total: number; byChannel: { kind: string; count: number }[] };
  resolution: {
    rate: number; // resolved / total
    autonomousRate: number; // resolved_autonomously / resolved
    procedureRate: number; // resolved_via_procedure / resolved
  };
  deflection: {
    rate: number; // tickets without a human reply / total resolved
    autonomousResolved: number;
    humanResolved: number;
  };
  responseTime: {
    ttfrMedianMs: number | null;
    ttfrP90Ms: number | null;
    ttrMedianMs: number | null;
    ttrP90Ms: number | null;
  };
  satisfaction: {
    csatScore: number | null; // -1..+1 (positive - negative) / total
    positiveCount: number;
    negativeCount: number;
  };
  followUpRate: number;
}

// Proactive resolution loop. The capstone of Phase 11.
//
// Phase 8 already detects unresolved-intent clusters and writes them to
// kb_suggestion. The proactive loop picks up open suggestions whose evidence
// implies a *workflow* gap (not just a missing article) and drafts a
// procedure spec for the operator to one-click accept. Anything below the
// PROACTIVE_EVAL_PASS_THRESHOLD on its draft evals is auto-rejected; no AI-
// drafted change ships without an empirical pass against the workspace's
// own historical cases.

export interface DiscoverResult {
  examined: number;
  drafted: number;
  auto_rejected: number;
  proposalIds: string[];
}

export interface PersistArgs {
  workspaceId: string;
  clusterKey: string;
  kind: ProactiveProposalKind;
  draft: ProactiveProposalDraft;
  passRate: number | null;
  caseCount: number;
  status: ProactiveProposalStatus;
  rejectedReason: string | null;
}

export interface StalenessComponents {
  age: number;
  drift: number;
  manual: number;
}

export interface KnowledgeHealth {
  averageStaleness: number;
  staleSourceCount: number;
  totalSourceCount: number;
  staleCitedRecently: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  topStaleSources: { id: string; title: string; staleness_score: number; last_crawled_at: number | null }[];
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

export interface ConversationScore {
  id: string;
  workspace_id: string;
  ticket_id: string;
  groundedness_score: number;
  tone_score: number;
  resolution_score: number;
  effort_score: number;
  overall_score: number;
  signals_json: string;
  scored_at: number;
  updated_at: number;
  subject?: string;
  status?: string;
  category?: string | null;
}

export interface InsightSummary {
  range_days: number;
  ticket_count: number;
  resolved_ticket_count: number;
  resolution_rate: number;
  open_ticket_count: number;
  pending_ticket_count: number;
  escalated_count: number;
  customer_followed_up_count: number;
  positive_feedback_count: number;
  negative_feedback_count: number;
  avg_groundedness_score: number | null;
  avg_tone_score: number | null;
  avg_resolution_score: number | null;
  avg_effort_score: number | null;
  avg_overall_score: number | null;
  escalation_reasons: Array<{ reason: string; count: number }>;
  top_unresolved_intents: Array<{ intent: string; count: number; example_ticket_id: string }>;
  slowest_procedures: Array<{
    procedure_id: string;
    slug: string;
    name: string;
    run_count: number;
    avg_duration_ms: number;
    waiting_count: number;
    failed_count: number;
  }>;
}

export interface KbSuggestion {
  id: string;
  workspace_id: string;
  cluster_key: string;
  title: string;
  summary: string;
  body_markdown: string;
  source_ticket_ids_json: string;
  suggested_terms_json: string;
  evidence_count: number;
  confidence_score: number;
  status: KbSuggestionStatus;
  source: string;
  accepted_source_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeDriftSignal {
  id: string;
  workspace_id: string;
  source_id: string;
  signal_hash: string;
  severity: KnowledgeDriftSeverity;
  title: string;
  summary: string;
  successful_reply_count: number;
  divergence_terms_json: string;
  example_ticket_ids_json: string;
  status: KnowledgeDriftStatus;
  detected_at: number;
  updated_at: number;
}

export interface WorkspaceInsightsMaintenanceResult {
  workspaceId: string;
  ok: boolean;
  scored: number;
  suggestions: number;
  drift: number;
  pruned: number;
  stale?: number;
  proposals?: number;
  error?: string;
}
