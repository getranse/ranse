import type { DraftResult } from '../server/schemas/draft';
import type { AgentConfig } from '../types/shared/llm';
import type { ResolvedTicketEvalInput } from './evals';
import type { AgenticKnowledgeResult, KnowledgeHit } from './knowledge';

export interface RunEvalSuiteOptions {
  source?: 'api' | 'cli' | 'ci' | 'scheduled';
  limit?: number;
  caseIds?: string[];
  threshold?: number;
  scoreDropThreshold?: number;
  workspaceConfig?: Partial<AgentConfig>;
  retrievalRunner?: (input: ResolvedTicketEvalInput) => Promise<AgenticKnowledgeResult>;
  draftRunner?: (input: ResolvedTicketEvalInput, knowledge: KnowledgeHit[]) => Promise<DraftResult>;
}
