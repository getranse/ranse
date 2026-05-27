import type { Hono } from 'hono';
import { z } from 'zod';
import { workspaceConfig } from '../../agents/supervisor/settings';
import { captureResolvedTicketEvalCases } from '../../evals/capture';
import { runEvalSuite } from '../../evals/replay';
import {
  getEvalRunDetail,
  listEvalCases,
  listEvalRuns,
  updateEvalCaseStatus,
} from '../../evals/storage';
import { apiError } from '../../lib/errors';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

const anonymizationSchema = z
  .object({
    redactEmails: z.boolean().optional(),
    redactPhones: z.boolean().optional(),
    redactRequesterName: z.boolean().optional(),
  })
  .optional();

export function registerEvalRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/evals/cases', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const cases = await listEvalCases(c.env, s.workspaceId, {
      status: c.req.query('status') === 'archived' ? 'archived' : 'active',
      limit: Number(c.req.query('limit') ?? 100),
    });
    return c.json({ cases });
  });

  apiApp.get('/evals/runs', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const runs = await listEvalRuns(c.env, s.workspaceId, Number(c.req.query('limit') ?? 20));
    return c.json({ runs });
  });

  apiApp.patch('/evals/cases/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({ status: z.enum(['active', 'archived']) }).parse(await c.req.json());
    const evalCase = await updateEvalCaseStatus(
      c.env,
      s.workspaceId,
      c.req.param('id'),
      body.status,
    );
    if (!evalCase) return apiError(c, 'not_found', 'That eval case does not exist.');
    return c.json({ case: evalCase });
  });

  apiApp.get('/evals/runs/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const detail = await getEvalRunDetail(c.env, s.workspaceId, c.req.param('id'));
    if (!detail) return apiError(c, 'not_found', 'That eval run does not exist.');
    return c.json(detail);
  });

  apiApp.post('/evals/cases/capture-resolved', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        anonymization: anonymizationSchema,
      })
      .parse(await c.req.json().catch(() => ({})));
    const result = await captureResolvedTicketEvalCases(c.env, s.workspaceId, {
      limit: body.limit,
      anonymization: body.anonymization,
      actorUserId: s.userId,
    });
    return c.json({ ok: result.failed === 0, ...result });
  });

  apiApp.post('/evals/runs', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        limit: z.number().int().min(1).max(500).optional(),
        case_ids: z.array(z.string()).max(500).optional(),
        threshold: z.number().min(0.05).max(0.95).optional(),
        score_drop_threshold: z.number().min(0.01).max(0.75).optional(),
        source: z.enum(['api', 'cli', 'ci', 'scheduled']).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const result = await runEvalSuite(c.env, s.workspaceId, {
      limit: body.limit,
      caseIds: body.case_ids,
      threshold: body.threshold,
      scoreDropThreshold: body.score_drop_threshold,
      source: body.source ?? 'api',
      workspaceConfig: await workspaceConfig(c.env, s.workspaceId),
    });
    const detail = await getEvalRunDetail(c.env, s.workspaceId, result.run.id);
    return c.json(detail ?? result);
  });
}
