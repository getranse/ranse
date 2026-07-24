import type { AgentConfig } from '../types/server/llm';
import type {
  AgenticRetrievalStepSource,
  KnowledgeSearchScope,
  KnowledgeSourceKind,
} from '../types/shared/knowledge';

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
