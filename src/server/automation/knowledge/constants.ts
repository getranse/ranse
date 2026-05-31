// Model identifiers stay here (they're algorithm choices for KB embedding/reranking).
// Tunable byte/char/timing knobs live in src/config/knowledge.ts and are re-exported
// here so existing knowledge/* importers keep working.

export const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
export const RERANKER_MODEL = '@cf/baai/bge-reranker-base';

export {
  MAX_SOURCE_BYTES,
  DEFAULT_CHUNK_CHARS,
  DEFAULT_OVERLAP_CHARS,
  SOURCE_STALE_AFTER_MS,
  URL_FETCH_TIMEOUT_MS,
  MAX_URL_REDIRECTS,
} from '../../../config/knowledge';
