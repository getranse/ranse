import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Application error code → HTTP status code. Add a new entry when introducing
 * a new error code; `apiError()` falls back to 500 for anything unmapped.
 * Values are team conventions (401 vs 403 for "you can't do this", 409 vs 422
 * for "conflict"), so this is config, not protocol.
 */
export const STATUS_FOR: Record<string, ContentfulStatusCode> = {
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  invalid_setup_token: 401,
  already_completed: 409,
  rate_limited: 429,
  conflict: 409,
};
