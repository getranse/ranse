import type { Hono } from 'hono';
import { decideApproval, getApprovalRequest } from '../../actions/approvals';
import { apiError } from '../../../lib/errors';
import { resumeProcedureRunner } from '../../automation/procedures/orchestration';
import { CAN_WORK_TICKETS, type Ctx, getSupervisor, requireWorkspaceRole } from './context';
import { approveBody, rejectBody } from '../../schemas/approvals';

export function registerApprovalRoutes(apiApp: Hono<Ctx>) {
  apiApp.post('/approvals/:id/approve', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const approval = await getApprovalRequest(c.env, s.workspaceId, c.req.param('id'));
    if (!approval) return apiError(c, 'not_found', 'That approval does not exist.');
    if (approval.kind === 'call_external') {
      const decided = await decideApproval(c.env, c.req.param('id'), 'approved', s.userId, s.workspaceId);
      if (!decided) return c.json({ ok: false, error: 'not_pending' });
      const runId = String(decided.proposed.procedure_run_id ?? '');
      if (runId) {
        await resumeProcedureRunner(c.env, s.workspaceId, runId, 'approval_decided', {
          approvalId: c.req.param('id'),
          approved: true,
          actorUserId: s.userId,
        });
      }
      return c.json({ ok: true });
    }
    const body = approveBody.parse(await c.req.json().catch(() => ({})));
    const stub = await getSupervisor(c.env, s.workspaceId);
    const result = await (stub as any).approveAndSend({ approvalId: c.req.param('id'), actorUserId: s.userId, edits: body.edits });
    return c.json(result);
  });

  apiApp.post('/approvals/:id/reject', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = rejectBody.parse(await c.req.json().catch(() => ({})));
    const approval = await getApprovalRequest(c.env, s.workspaceId, c.req.param('id'));
    if (!approval) return apiError(c, 'not_found', 'That approval does not exist.');
    if (approval.kind === 'call_external') {
      const decided = await decideApproval(c.env, c.req.param('id'), 'rejected', s.userId, s.workspaceId);
      if (!decided) return c.json({ ok: false, error: 'not_pending' });
      const runId = String(decided.proposed.procedure_run_id ?? '');
      if (runId) {
        await resumeProcedureRunner(c.env, s.workspaceId, runId, 'approval_decided', {
          approvalId: c.req.param('id'),
          approved: false,
          actorUserId: s.userId,
          reason: body.reason,
        });
      }
      return c.json({ ok: true });
    }
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).rejectApproval({ approvalId: c.req.param('id'), actorUserId: s.userId, reason: body.reason });
    return c.json({ ok: true });
  });
}
