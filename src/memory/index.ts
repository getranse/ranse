export type { CustomerMemory, CustomerMemoryKind, ExtractedFact } from '../types/memory';
export { extractMemoryFromTicket } from './extract';
export { ingestExtractedFacts, listMemory, redactMemory, upsertMemory } from './store';
