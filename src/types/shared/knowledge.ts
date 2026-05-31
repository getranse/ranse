import type { KnowledgeHit, AgenticRetrievalPlan, AgenticRetrievalJudgment, AgenticRetrievalHop, AgenticRetrievalTrace, AgenticKnowledgeResult, KnowledgeSourceListItem, KnowledgeIngestResult, ResolvedTicketImportResult } from '../../interfaces/knowledge';
export type { KnowledgeHit, AgenticRetrievalPlan, AgenticRetrievalJudgment, AgenticRetrievalHop, AgenticRetrievalTrace, AgenticKnowledgeResult, KnowledgeSourceListItem, KnowledgeIngestResult, ResolvedTicketImportResult };
export type KnowledgeSourceKind = 'manual' | 'url' | 'pdf' | 'resolved_ticket';
export const KNOWLEDGE_SEARCH_SCOPES = ['knowledge', 'resolved_tickets', 'customer_data', 'all'] as const;
export type KnowledgeSearchScope = (typeof KNOWLEDGE_SEARCH_SCOPES)[number];
export type AgenticRetrievalStepSource = 'llm' | 'fallback' | 'injected' | 'system';

export type KnowledgeInspectionHit = KnowledgeHit & { cited?: boolean };
