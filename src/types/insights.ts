export type KbSuggestionStatus = 'open' | 'accepted' | 'dismissed';
export type KnowledgeDriftStatus = 'open' | 'resolved' | 'dismissed';
export type KnowledgeDriftSeverity = 'low' | 'medium' | 'high';

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
