export { chunkText } from './chunking';
export { extractTextFromPdfBytes } from './pdf';
export { extractReadableTextFromHtml } from './text';
export { agenticSearchKnowledge, searchProcedurePrimitive } from './agentic';
export type { AgenticSearchOptions } from './agentic';
export { importResolvedTickets, ingestKnowledgeSource, listKnowledgeSources } from './sources';
export { recordKnowledgeUsage, searchKnowledge } from './search';
export type {
  KnowledgeHit,
  AgenticKnowledgeResult,
  AgenticRetrievalTrace,
  KnowledgeIngestResult,
  KnowledgeSearchScope,
  KnowledgeInspectionHit,
  KnowledgeSourceKind,
  KnowledgeSourceListItem,
  ResolvedTicketImportResult,
} from '../types/knowledge';
