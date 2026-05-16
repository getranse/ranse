export type KnowledgeSourceKind = 'manual' | 'url' | 'pdf' | 'resolved_ticket';

export interface KnowledgeHit {
  id: string;
  sourceId: string;
  sourceKind: KnowledgeSourceKind;
  title: string;
  url?: string;
  snippet: string;
  score: number;
  usedInAnswersCount: number;
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
