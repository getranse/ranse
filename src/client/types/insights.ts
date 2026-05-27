import type {
  ConversationScore,
  InsightSummary,
  KbSuggestion,
  KnowledgeDriftSignal,
} from '../../types/insights';

export type InsightSummaryEntry = InsightSummary;
export type ConversationScoreEntry = ConversationScore;
export type KbSuggestionEntry = KbSuggestion;
export type KnowledgeDriftSignalEntry = KnowledgeDriftSignal;

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
