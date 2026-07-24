import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import {
  getEvalRunDetail,
  listEvalCases,
  listEvalRuns,
  updateEvalCaseStatus,
} from '../../actions/evals';
import { captureResolvedTicketEvalCases } from '../../automation/evals/capture';
import { runEvalSuite } from '../../automation/evals/replay';
import { workspaceConfig } from '../../inbox/agents/supervisor/llm-config';
import { captureResolvedBody, caseStatusPatch, runEvalBody } from '../../schemas/evals';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

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
    const body = caseStatusPatch.parse(await c.req.json());
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
    const body = captureResolvedBody.parse(await c.req.json().catch(() => ({})));
    const result = await captureResolvedTicketEvalCases(c.env, s.workspaceId, {
      limit: body.limit,
      anonymization: body.anonymization,
      actorUserId: s.userId,
    });
    return c.json({ ok: result.failed === 0, ...result });
  });

  apiApp.post('/evals/runs', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = runEvalBody.parse(await c.req.json().catch(() => ({})));
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
