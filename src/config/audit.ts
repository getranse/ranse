// Audit retention is opt-in: set the AUDIT_RETENTION_DAYS env var to a positive
// number of days to enable the weekly purge sweep. Unset/0 keeps events forever.

/** Decision-trace public-link expiry window (30 days). */
export const TRACE_DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60_000;
