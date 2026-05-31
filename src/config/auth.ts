/** Session cookie max-age in seconds (30 days). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** PBKDF2 iteration count for new password hashes. Increase as hardware
 *  improves; existing hashes carry their own iteration count in the encoded
 *  string and are re-hashed on next login if below `MIN_PBKDF2_ITERATIONS`. */
export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PBKDF2_ITERATIONS = 10_000;
