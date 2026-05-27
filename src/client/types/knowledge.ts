import type {
  AgenticRetrievalTrace,
  KnowledgeHit,
  KnowledgeInspectionHit,
  KnowledgeSourceListItem,
} from '../../types/knowledge';

export type KnowledgeSource = KnowledgeSourceListItem;
export type KnowledgeSearchHit = KnowledgeHit;
export type AnswerInspectionHit = KnowledgeInspectionHit;
export type AnswerInspectionTrace = AgenticRetrievalTrace;

export interface KnowledgeIngestResult {
  ok: boolean;
  id: string;
  chunks: number;
  vectorized: boolean;
}

export type KnowledgeInput =
  | { kind: 'manual'; title?: string; body: string }
  | { kind: 'url'; title?: string; url: string }
  | { kind: 'pdf'; title?: string; file: File };
