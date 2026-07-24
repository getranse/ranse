/** Inbound public-channel message body length cap. */
export const MESSAGE_LIMIT = 5000;

/** Inbound public-channel subject length cap (also applies to channel ingress-state synthesized subjects). */
export const SUBJECT_LIMIT = 180;

/** Preview text length stored on ticket/message rows for fast list rendering. */
export const PREVIEW_CHARS = 280;

/** Soft bounces escalate to a full auto-send suppression after this many failures. */
export const SOFT_BOUNCE_SUPPRESS_AFTER = 3;

/** Customer feedback links stay valid this long after the reply is sent. */
export const FEEDBACK_LINK_TTL_MS = 1000 * 60 * 60 * 24 * 90;

/** Customer portal ("View your request") links stay valid this long. */
export const PORTAL_LINK_TTL_MS = 1000 * 60 * 60 * 24 * 90;

/** Outbound channel dispatch: attempt cap and backoff schedule. */
export const DISPATCH_MAX_ATTEMPTS = 5;
export const DISPATCH_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];

/** Realtime voice: caller audio buffered before a transcription turn. */
export const VOICE_TURN_BUFFER_MS = 1500;
