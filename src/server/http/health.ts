import { Hono } from 'hono';
import type { Env } from '../env';

export const healthApp = new Hono<{ Bindings: Env }>();

healthApp.get('/healthz', (c) =>
  c.json({
    ok: true,
    name: c.env.APP_NAME,
    version: c.env.CF_VERSION?.id,
  }),
);
