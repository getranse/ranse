import type {
  AgenticKnowledgeResult,
  AgenticRetrievalHop,
  AgenticRetrievalJudgment,
  AgenticRetrievalPlan,
  AgenticRetrievalTrace,
  KnowledgeHit,
} from '../../interfaces/knowledge';
import type {
  KnowledgeIngestResult,
  KnowledgeSourceListItem,
  ResolvedTicketImportResult,
} from '../../interfaces/knowledge-sources';

export type {
  AgenticKnowledgeResult,
  AgenticRetrievalHop,
  AgenticRetrievalJudgment,
  AgenticRetrievalPlan,
  AgenticRetrievalTrace,
  KnowledgeHit,
  KnowledgeIngestResult,
  KnowledgeSourceListItem,
  ResolvedTicketImportResult,
};
export type KnowledgeSourceKind = 'manual' | 'url' | 'pdf' | 'resolved_ticket';
export const KNOWLEDGE_SEARCH_SCOPES = [
  'knowledge',
  'resolved_tickets',
  'customer_data',
  'all',
] as const;
export type KnowledgeSearchScope = (typeof KNOWLEDGE_SEARCH_SCOPES)[number];
export type AgenticRetrievalStepSource = 'llm' | 'fallback' | 'injected' | 'system';

export type KnowledgeInspectionHit = KnowledgeHit & { cited?: boolean };
