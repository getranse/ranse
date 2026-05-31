import type { ApiError } from '../interfaces/lib';
export type { ApiError };
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { STATUS_FOR } from '../config/errors';

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
