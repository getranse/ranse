import { routeAgentRequest } from 'agents';
import { Hono } from 'hono';
import type { Env } from '../env';
import { apiApp } from './api/routes';
import { assetsApp } from './assets';
import { authApp } from './auth';
import { handleHttpError } from './errors';
import { feedbackApp } from './feedback';
import { healthApp } from './health';
import { helpApp } from './help';
import { portalApp } from './portal';
import { publicChannelsApp, publicSurfaceApp } from './public-channels';
import { setupApp } from './setup';
import { traceApp } from './trace';

export const app = new Hono<{ Bindings: Env }>();

app.onError(handleHttpError);

app.route('/', healthApp);
app.route('/setup', setupApp);
app.route('/auth', authApp);
app.route('/feedback', feedbackApp);
app.route('/portal', portalApp);
app.route('/help', helpApp);
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
