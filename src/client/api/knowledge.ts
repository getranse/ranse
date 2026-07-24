import type {
  AnswerInspectionTrace,
  KnowledgeIngestResult,
  KnowledgeInput,
  KnowledgeSearchHit,
  KnowledgeSource,
} from '../../types/client/knowledge';
import { api, uploadFile } from './core';

export const knowledgeApi = {
  setKnowledgePublic: (id: string, isPublic: boolean) =>
    api<any>(`/api/knowledge/${id}/public`, {
      method: 'PATCH',
      body: JSON.stringify({ public: isPublic }),
    }),
  listKnowledge: () => api<{ sources: KnowledgeSource[] }>('/api/knowledge'),
  // Single entry point for all source kinds. PDFs go up as multipart (the file
  // carries bytes to extract); manual/url sources as JSON. Both hit POST /api/knowledge.
  createKnowledge: (input: KnowledgeInput) =>
    input.kind === 'pdf'
      ? uploadFile<KnowledgeIngestResult>(
          '/api/knowledge',
          input.file,
          input.title ? { title: input.title } : undefined,
        )
      : api<KnowledgeIngestResult>('/api/knowledge', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
  reindexKnowledge: (id: string) =>
    api<KnowledgeIngestResult>(`/api/knowledge/${id}/reindex`, { method: 'POST' }),
  searchKnowledge: (query: string, limit = 5) =>
    api<{
      hits: KnowledgeSearchHit[];
      trace?: AnswerInspectionTrace;
    }>('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ query, limit }) }),
  importResolvedTicketsKnowledge: (limit = 50) =>
    api<{ ok: boolean; imported: number; skipped: number; failed: number }>(
      '/api/knowledge/import-resolved-tickets',
      {
        method: 'POST',
        body: JSON.stringify({ limit }),
      },
    ),
};
