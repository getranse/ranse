import type { OperationsMetricsResponse, KnowledgeHealthResponse, ProactiveProposalResponse, HonestResolutionResponse } from '../../interfaces/insights';
export type { OperationsMetricsResponse, KnowledgeHealthResponse, ProactiveProposalResponse, HonestResolutionResponse };
import type {
  ConversationScore,
  InsightSummary,
  KbSuggestion,
  KnowledgeDriftSignal,
} from '../shared/insights';

export type InsightSummaryEntry = InsightSummary;
export type ConversationScoreEntry = ConversationScore;
export type KbSuggestionEntry = KbSuggestion;
export type KnowledgeDriftSignalEntry = KnowledgeDriftSignal;
