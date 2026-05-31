import type { AgentConfig } from '../types/server/llm';
import type { KnowledgeSearchScope, KnowledgeSourceKind, AgenticRetrievalStepSource } from '../types/shared/knowledge';

export interface AgenticSearchOptions {
  limit?: number;
  maxHops?: number;
  scope?: KnowledgeSearchScope;
  workspaceConfig?: Partial<AgentConfig>;
  planner?: (query: string) => Promise<AgenticRetrievalPlan>;
  judge?: (args: {
    originalQuery: string;
    query: string;
    hits: KnowledgeHit[];
    hop: number;
  }) => Promise<AgenticRetrievalJudgment>;
}

export interface KnowledgeSearchOptions {
  sourceKinds?: KnowledgeSourceKind[];
}

export interface KnowledgeIngestResult {
  sourceId: string;
  chunks: number;
  vectorized: boolean;
}

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
  stalenessScore?: number;
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

export interface ResolvedTicketImportResult {
  imported: number;
  skipped: number;
  failed: number;
}
