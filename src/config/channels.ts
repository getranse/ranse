/** Inbound public-channel message body length cap. */
export const MESSAGE_LIMIT = 5000;

/** Inbound public-channel subject length cap (also applies to channel ingress-state synthesized subjects). */
export const SUBJECT_LIMIT = 180;

/** Preview text length stored on ticket/message rows for fast list rendering. */
export const PREVIEW_CHARS = 280;

/** Soft bounces escalate to a full auto-send suppression after this many failures. */
export const SOFT_BOUNCE_SUPPRESS_AFTER = 3;
