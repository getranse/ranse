import type { KnowledgeSourceKind } from '../types/shared/knowledge';

export interface KnowledgeIngestResult {
  sourceId: string;
  chunks: number;
  vectorized: boolean;
}

export interface KnowledgeSourceListItem {
  id: string;
  kind: KnowledgeSourceKind;
  title: string;
  url: string | null;
  r2_key: string | null;
  source_url: string | null;
  public: number;
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
