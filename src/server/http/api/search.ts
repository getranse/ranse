import type { Hono } from 'hono';
import { searchTickets } from '../../actions/search';
import type { Ctx } from './context';

export function registerSearchRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/search/tickets', async (c) => {
    const s = c.get('session');
    const q = c.req.query('q')?.trim() ?? '';
    if (!q) return c.json({ tickets: [] });
    const limit = Number(c.req.query('limit') ?? 20);
    const tickets = await searchTickets(
      c.env,
      s.workspaceId,
      q,
      Number.isFinite(limit) ? limit : 20,
    );
    return c.json({ tickets });
  });
}
