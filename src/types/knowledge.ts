export type KnowledgeSourceKind = 'manual' | 'url' | 'pdf' | 'resolved_ticket';
export type KnowledgeSearchScope = 'knowledge' | 'resolved_tickets' | 'customer_data' | 'all';
export type AgenticRetrievalStepSource = 'llm' | 'fallback' | 'injected' | 'system';

export interface KnowledgeHit {
  id: string;
  sourceId: string;
  sourceKind: KnowledgeSourceKind;
  title: string;
  url?: string;
  snippet: string;
  score: number;
  usedInAnswersCount: number;
  updatedAt?: number;
}

export interface AgenticRetrievalPlan {
  originalQuery: string;
  scope: KnowledgeSearchScope;
  subqueries: string[];
  maxHops: number;
  source?: AgenticRetrievalStepSource;
  model?: string;
}

export interface AgenticRetrievalJudgment {
  sufficient: boolean;
  reasoning: string;
  missing: string[];
  nextQuery?: string;
  source?: AgenticRetrievalStepSource;
  model?: string;
}

export interface AgenticRetrievalHop {
  hop: number;
  query: string;
  scope: KnowledgeSearchScope;
  hits: KnowledgeHit[];
  judgment: AgenticRetrievalJudgment;
  accumulatedHitCount?: number;
  searchMs?: number;
  judgeMs?: number;
}

export interface AgenticRetrievalTrace {
  plan: AgenticRetrievalPlan;
  hops: AgenticRetrievalHop[];
  finalAnswerable: boolean;
  stopReason: 'sufficient' | 'max_hops' | 'no_next_query' | 'no_hits';
  startedAt?: number;
  durationMs?: number;
}

export interface AgenticKnowledgeResult {
  hits: KnowledgeHit[];
  trace: AgenticRetrievalTrace;
}

export type KnowledgeInspectionHit = KnowledgeHit & { cited?: boolean };

export interface KnowledgeSourceListItem {
  id: string;
  kind: KnowledgeSourceKind;
  title: string;
  url: string | null;
  r2_key: string | null;
  source_url: string | null;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  chunk_count: number;
  used_in_answers_count: number;
  last_crawled_at: number | null;
  last_indexed_at: number | null;
  stale: boolean;
  duplicate_count: number;
  error: string | null;
  updated_at: number;
}

export interface KnowledgeIngestResult {
  sourceId: string;
  chunks: number;
  vectorized: boolean;
}

export interface ResolvedTicketImportResult {
  imported: number;
  skipped: number;
  failed: number;
}
