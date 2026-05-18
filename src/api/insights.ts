import type { Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../lib/errors';
import {
  acceptKbSuggestion,
  detectKnowledgeDrift,
  generateKbSuggestions,
  getInsightSummary,
  listConversationScores,
  listKbSuggestions,
  listKnowledgeDriftSignals,
  scoreWorkspaceConversations,
  updateKbSuggestionStatus,
  updateKnowledgeDriftStatus,
} from '../insights';
import { OWNER_OR_ADMIN, requireWorkspaceRole, type Ctx } from './context';

const limitSchema = z.object({ limit: z.number().int().min(1).max(500).optional() });
const suggestionStatusSchema = z.object({ status: z.enum(['open', 'dismissed']) });
const driftStatusSchema = z.object({ status: z.enum(['open', 'resolved', 'dismissed']) });

export function registerInsightRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/insights/summary', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
    return c.json({ summary: await getInsightSummary(c.env, s.workspaceId, days) });
  });

  apiApp.get('/insights/scores', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
    return c.json({ scores: await listConversationScores(c.env, s.workspaceId, limit) });
  });

  apiApp.post('/insights/scores/run', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = limitSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await scoreWorkspaceConversations(c.env, s.workspaceId, body.limit ?? 100));
  });

  apiApp.get('/insights/kb-suggestions', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const status = c.req.query('status');
    return c.json({
      suggestions: await listKbSuggestions(
        c.env,
        s.workspaceId,
        status === 'open' || status === 'accepted' || status === 'dismissed' ? status : undefined,
      ),
    });
  });

  apiApp.post('/insights/kb-suggestions/run', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = limitSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await generateKbSuggestions(c.env, s.workspaceId, body.limit ?? 100));
  });

  apiApp.patch('/insights/kb-suggestions/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = suggestionStatusSchema.parse(await c.req.json());
    try {
      const suggestion = await updateKbSuggestionStatus(
        c.env,
        s.workspaceId,
        c.req.param('id'),
        body.status,
        s.userId,
      );
      if (!suggestion) return apiError(c, 'not_found', 'Suggestion not found.');
      return c.json({ suggestion });
    } catch (err) {
      if (err instanceof Error && err.message === 'kb_suggestion_accepted') {
        return apiError(c, 'conflict', 'Accepted suggestions cannot be changed.', 409);
      }
      throw err;
    }
  });

  apiApp.post(
    '/insights/kb-suggestions/:id/accept',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      try {
        const result = await acceptKbSuggestion(c.env, s.workspaceId, c.req.param('id'), s.userId);
        if (!result) return apiError(c, 'not_found', 'Suggestion not found.');
        return c.json(result);
      } catch (err) {
        if (err instanceof Error && err.message === 'kb_suggestion_not_open') {
          return apiError(c, 'conflict', 'Only open suggestions can be accepted.', 409);
        }
        throw err;
      }
    },
  );

  apiApp.get('/insights/drift', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const status = c.req.query('status');
    return c.json({
      signals: await listKnowledgeDriftSignals(
        c.env,
        s.workspaceId,
        status === 'open' || status === 'resolved' || status === 'dismissed' ? status : undefined,
      ),
    });
  });

  apiApp.post('/insights/drift/run', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json(await detectKnowledgeDrift(c.env, s.workspaceId));
  });

  apiApp.patch('/insights/drift/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = driftStatusSchema.parse(await c.req.json());
    const signal = await updateKnowledgeDriftStatus(
      c.env,
      s.workspaceId,
      c.req.param('id'),
      body.status,
      s.userId,
    );
    if (!signal) return apiError(c, 'not_found', 'Drift signal not found.');
    return c.json({ signal });
  });
}
