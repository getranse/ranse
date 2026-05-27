import { routeAgentRequest } from 'agents';
import { Hono } from 'hono';
import type { Env } from '../env';
import { apiApp } from './api/routes';
import { assetsApp } from './assets';
import { authApp } from './auth';
import { publicChannelsApp, publicSurfaceApp } from './public-channels';
import { feedbackApp } from './feedback';
import { traceApp } from './trace';
import { setupApp } from './setup';
import { handleHttpError } from './errors';
import { healthApp } from './health';

export const app = new Hono<{ Bindings: Env }>();

app.onError(handleHttpError);

app.route('/', healthApp);
app.route('/setup', setupApp);
app.route('/auth', authApp);
app.route('/feedback', feedbackApp);
app.route('/public', publicChannelsApp);
app.route('/public', traceApp);
app.route('/api', apiApp);
app.route('/assets', assetsApp);
app.route('/', publicSurfaceApp);

app.all('/agents/*', async (c) => {
  const res = await routeAgentRequest(c.req.raw, c.env as any);
  return res ?? c.notFound();
});

app.notFound(async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Not found', 404);
});
