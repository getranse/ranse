/** Default retention window for audit_event rows. Override via AUDIT_RETENTION_DAYS env var. */
export const DEFAULT_RETENTION_DAYS = 365;

/** Decision-trace public-link expiry window (30 days). */
export const TRACE_DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60_000;
