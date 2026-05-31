/** Maximum bytes ingested for a single knowledge source (manual/url/pdf body). */
export const MAX_SOURCE_BYTES = 1_000_000;

/** Token-budget-friendly chunk size for KB embeddings. */
export const DEFAULT_CHUNK_CHARS = 2400;

/** Overlap between adjacent chunks to preserve semantic continuity at boundaries. */
export const DEFAULT_OVERLAP_CHARS = 240;

/** A KB source becomes stale-eligible after this since last successful crawl. */
export const SOURCE_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Per-fetch timeout when crawling a URL source. */
export const URL_FETCH_TIMEOUT_MS = 15_000;

/** Cap on URL redirect hops during crawl to avoid loops/SSRF chains. */
export const MAX_URL_REDIRECTS = 5;

/** Cap on PDF upload size for KB ingestion. */
export const MAX_KNOWLEDGE_PDF_BYTES = 10 * 1024 * 1024;

/** Real-time draft-assist (composer copilot) tuning. */
export const ASSIST_KB_HITS = 4;
export const ASSIST_PAST_TICKETS = 3;
export const ASSIST_COMPLETION_MAX_CHARS = 220;
