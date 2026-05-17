import type { Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../lib/errors';
import { CAN_WORK_TICKETS, type Ctx, getSupervisor, requireWorkspaceRole } from './context';

export function registerTicketRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/tickets', async (c) => {
    const s = c.get('session');
    const stub = await getSupervisor(c.env, s.workspaceId);
    const tickets = await (stub as any).listTickets({ status: c.req.query('status'), limit: 50 });
    return c.json({ tickets });
  });

  apiApp.get('/tickets/:id', async (c) => {
    const s = c.get('session');
    const stub = await getSupervisor(c.env, s.workspaceId);
    const data = await (stub as any).getTicket(c.req.param('id'));
    if (!data) return apiError(c, 'not_found', 'That ticket doesn\'t exist or is not in your workspace.');
    return c.json(data);
  });

  apiApp.post('/tickets/:id/assign', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({ userId: z.string().nullable() }).parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).assignTicket({ ticketId: c.req.param('id'), userId: body.userId, actorUserId: s.userId });
    return c.json({ ok: true });
  });

  apiApp.post('/tickets/:id/status', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({ status: z.enum(['open', 'pending', 'resolved', 'closed', 'spam']) })
      .parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setTicketStatus({ ticketId: c.req.param('id'), status: body.status, actorUserId: s.userId });
    return c.json({ ok: true });
  });

  apiApp.post('/tickets/:id/note', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({ body: z.string().min(1).max(20000) }).parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).addInternalNote({ ticketId: c.req.param('id'), body: body.body, actorUserId: s.userId });
    return c.json({ ok: true });
  });

  apiApp.post('/tickets/:id/reply', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({
      body: z.string().min(1).max(50000),
      subject: z.string().max(998).optional(),
      cited_knowledge_ids: z.array(z.string()).max(20).optional(),
    }).parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    const result = await (stub as any).replyDirect({
      ticketId: c.req.param('id'),
      actorUserId: s.userId,
      body: body.body,
      subject: body.subject,
      citedKnowledgeIds: body.cited_knowledge_ids,
    });
    return c.json(result);
  });

  apiApp.post('/tickets/:id/draft', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const stub = await getSupervisor(c.env, s.workspaceId);
    const result = await (stub as any).draftReply({ ticketId: c.req.param('id'), actorUserId: s.userId });
    return c.json(result);
  });

  apiApp.post('/tickets/:id/ai-drafts', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({ enabled: z.boolean().nullable() }).parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setTicketAiDrafts({ ticketId: c.req.param('id'), actorUserId: s.userId, enabled: body.enabled });
    return c.json({ ok: true });
  });

  apiApp.post('/tickets/:id/feedback', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({
      rating: z.enum(['positive', 'negative']),
      message_id: z.string().nullable().optional(),
      comment: z.string().max(2000).nullable().optional(),
    }).parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    const result = await (stub as any).recordFeedback({
      ticketId: c.req.param('id'),
      actorUserId: s.userId,
      messageId: body.message_id,
      rating: body.rating,
      comment: body.comment,
    });
    if (!result.ok) return apiError(c, 'not_found', 'Ticket not found.');
    return c.json(result);
  });
}
