import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Standard JSON error body shape used across all API routes:
 *   { error: <snake_case_code>, message: <human readable>, details?: ... }
 *
 * The UI API client picks up `message` and falls back to `error`.
 */
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

const STATUS_FOR: Record<string, ContentfulStatusCode> = {
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

export function apiError(
  c: Context<any>,
  code: string,
  message: string,
  status?: ContentfulStatusCode,
  details?: Record<string, unknown>,
) {
  const body: ApiError = { error: code, message, ...(details ? { details } : {}) };
  return c.json(body, status ?? STATUS_FOR[code] ?? 500);
}
