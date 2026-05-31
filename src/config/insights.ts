/** Default rolling window for ops / honest-resolution / outcome rollup queries (days). */
export const DEFAULT_WINDOW_DAYS = 30;

/** Selectable rolling-window options surfaced in the operations dashboard UI. */
export const WINDOW_OPTIONS = [7, 30, 90];

/** Knowledge-source staleness decay half-life. After this many days since last crawl, staleness=0.5. */
export const HALF_LIFE_DAYS = 180;
export const HALF_LIFE_MS = HALF_LIFE_DAYS * 24 * 60 * 60_000;

/** Maximum additional staleness contributed by drift signals on a single source. */
export const MAX_DRIFT_BUMP = 0.5;

/** Sources with staleness ≥ this are surfaced as "stale" in the knowledge-health view. */
export const STALE_THRESHOLD = 0.6;

/** Minimum unresolved-ticket cluster size before generating a KB suggestion. */
export const MIN_SUGGESTION_TICKETS = 2;

/** Minimum successful-reply count before raising a knowledge-drift signal. */
export const MIN_DRIFT_REPLIES = 2;

/** Cap on chunks-per-source used when reconstructing answer lineage. */
export const MAX_SOURCE_CHUNKS_FOR_LINEAGE = 50;

/** How long conversation_score rows are retained (days) before the weekly sweep prunes them. */
export const CONVERSATION_SCORE_RETENTION_DAYS = 180;
