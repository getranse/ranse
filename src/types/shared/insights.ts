import type { ConversationScore, InsightSummary, KbSuggestion, KnowledgeDriftSignal, WorkspaceInsightsMaintenanceResult } from '../../interfaces/insights';
export type { ConversationScore, InsightSummary, KbSuggestion, KnowledgeDriftSignal, WorkspaceInsightsMaintenanceResult };
export type KbSuggestionStatus = 'open' | 'accepted' | 'dismissed';
export const KNOWLEDGE_DRIFT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type KnowledgeDriftStatus = (typeof KNOWLEDGE_DRIFT_STATUSES)[number];
export type KnowledgeDriftSeverity = 'low' | 'medium' | 'high';
