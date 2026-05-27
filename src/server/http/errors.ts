import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import type { Env } from '../env';

export const handleHttpError: ErrorHandler<{ Bindings: Env }> = (err, c) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}] ${c.req.method} ${c.req.path}`, err);

  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.join('.') || 'request';
    return c.json(
      {
        error: 'validation_error',
        message: `${field}: ${first?.message ?? 'invalid input'}`,
        details: { issues: err.issues },
        requestId,
      },
      400,
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause ? String(err.cause) : undefined;
  return c.json(
    {
      error: 'internal_error',
      message: `Something went wrong: ${message}`,
      details: cause ? { cause } : undefined,
      requestId,
    },
    500,
  );
};
