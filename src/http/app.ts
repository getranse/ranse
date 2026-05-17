import { routeAgentRequest } from 'agents';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { Env } from '../env';
import { apiApp } from '../api/routes';
import { assetsApp } from '../assets/routes';
import { authApp } from '../auth/routes';
import { feedbackApp } from '../feedback/routes';
import { setupApp } from '../setup/wizard';

export const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({
  ok: true,
  name: c.env.APP_NAME,
  version: c.env.CF_VERSION?.id,
}));

app.onError((err, c) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}] ${c.req.method} ${c.req.path}`, err);
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.join('.') || 'request';
    return c.json({
      error: 'validation_error',
      message: `${field}: ${first?.message ?? 'invalid input'}`,
      details: { issues: err.issues },
      requestId,
    }, 400);
  }

  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause ? String(err.cause) : undefined;
  return c.json({
    error: 'internal_error',
    message: `Something went wrong: ${message}`,
    details: cause ? { cause } : undefined,
    requestId,
  }, 500);
});

app.route('/setup', setupApp);
app.route('/auth', authApp);
app.route('/feedback', feedbackApp);
app.route('/api', apiApp);
app.route('/assets', assetsApp);

app.all('/agents/*', async (c) => {
  const res = await routeAgentRequest(c.req.raw, c.env as any);
  return res ?? c.notFound();
});

app.notFound(async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Not found', 404);
});
