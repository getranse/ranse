import type { Hono } from 'hono';
import { z } from 'zod';
import { CAN_WORK_TICKETS, type Ctx, getSupervisor, requireWorkspaceRole } from './context';

export function registerApprovalRoutes(apiApp: Hono<Ctx>) {
  apiApp.post('/approvals/:id/approve', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({
      edits: z.object({ subject: z.string().optional(), body_markdown: z.string().optional() }).optional(),
    }).parse(await c.req.json().catch(() => ({})));
    const stub = await getSupervisor(c.env, s.workspaceId);
    const result = await (stub as any).approveAndSend({ approvalId: c.req.param('id'), actorUserId: s.userId, edits: body.edits });
    return c.json(result);
  });

  apiApp.post('/approvals/:id/reject', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({ reason: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).rejectApproval({ approvalId: c.req.param('id'), actorUserId: s.userId, reason: body.reason });
    return c.json({ ok: true });
  });
}
