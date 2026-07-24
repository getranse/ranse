import type { KnowledgeIngestResult } from '../../interfaces/knowledge-sources';

export type { KnowledgeIngestResult };

import type {
  AgenticRetrievalTrace,
  KnowledgeHit,
  KnowledgeInspectionHit,
  KnowledgeSourceListItem,
} from '../shared/knowledge';

export type KnowledgeSource = KnowledgeSourceListItem;
export type KnowledgeSearchHit = KnowledgeHit;
export type AnswerInspectionHit = KnowledgeInspectionHit;
export type AnswerInspectionTrace = AgenticRetrievalTrace;

export type KnowledgeInput =
  | { kind: 'manual'; title?: string; body: string }
  | { kind: 'url'; title?: string; url: string }
  | { kind: 'pdf'; title?: string; file: File };
