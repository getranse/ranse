import type { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../env';
import { apiError } from '../../lib/errors';
import { getText } from '../../lib/storage';
import { listMemory } from '../../memory/store';
import { buildTraceLink } from '../../lib/decision-trace';
import { audit, auditContext, isReadLoggingEnabled } from '../../lib/audit';
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
    // PII read-access logging (opt-in per workspace; high-volume so off by
    // default). A ticket thread exposes the customer's email and message
    // bodies, so it's the primary read surface to log. Kept off the critical
    // path — the enablement check and write both run after the response.
    const context = auditContext(c);
    c.executionCtx.waitUntil(
      (async () => {
        if (!(await isReadLoggingEnabled(c.env, s.workspaceId))) return;
        await audit(c.env, {
          workspaceId: s.workspaceId,
          ticketId: c.req.param('id'),
          actorType: 'user',
          actorId: s.userId,
          action: 'data.ticket_viewed',
          payload: { ticketId: c.req.param('id') },
          context,
        });
      })().catch((err) => console.warn('ticket read audit failed', err)),
    );
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
    if (body.status === 'resolved' || body.status === 'closed') {
      // Memory extraction runs after the resolution returns to the
      // operator. waitUntil keeps it off the request critical path; a
      // failure here never blocks the status change.
      const { extractMemoryFromTicket } = await import('../../memory');
      c.executionCtx.waitUntil(
        extractMemoryFromTicket(c.env, {
          workspaceId: s.workspaceId,
          ticketId: c.req.param('id'),
        }).catch((err) => console.warn('memory extraction failed', err)),
      );
    }
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

  apiApp.post('/tickets/:id/draft-assist', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        draft: z.string().max(50_000),
        cursor: z.number().int().min(0).max(50_000).optional(),
      })
      .parse(await c.req.json());
    const { runDraftAssist } = await import('../../agents/specialists/assist');
    const ticketId = c.req.param('id');
    const ctx = await loadAssistContext(c.env, s.workspaceId, ticketId);
    if (!ctx) return apiError(c, 'not_found', 'Ticket not found.');
    const result = await runDraftAssist({
      env: c.env,
      workspaceId: s.workspaceId,
      ticketId,
      ticketSubject: ctx.subject,
      customerLastMessage: ctx.customerLastMessage,
      customerMemoryFacts: ctx.memoryFacts,
      draft: { draftText: body.draft, cursor: body.cursor },
    });
    return c.json(result);
  });

  apiApp.post('/tickets/:id/ai-drafts', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = z.object({ enabled: z.boolean().nullable() }).parse(await c.req.json());
    const stub = await getSupervisor(c.env, s.workspaceId);
    await (stub as any).setTicketAiDrafts({ ticketId: c.req.param('id'), actorUserId: s.userId, enabled: body.enabled });
    return c.json({ ok: true });
  });

  apiApp.get(
    '/tickets/:id/messages/:messageId/trace-url',
    requireWorkspaceRole(CAN_WORK_TICKETS),
    async (c) => {
      const s = c.get('session');
      const ticketId = c.req.param('id');
      const messageId = c.req.param('messageId');
      const message = await c.env.DB.prepare(
        `SELECT id, author_user_id FROM message_index
           WHERE id = ? AND ticket_id = ? AND workspace_id = ? AND direction = 'outbound'`,
      )
        .bind(messageId, ticketId, s.workspaceId)
        .first<{ id: string; author_user_id: string | null }>();
      if (!message) return apiError(c, 'not_found', 'Message not found on this ticket.');
      if (message.author_user_id) {
        return apiError(
          c,
          'bad_request',
          'Trace links are only available for AI-authored replies.',
          400,
        );
      }
      const url = await buildTraceLink(c.env, {
        workspaceId: s.workspaceId,
        ticketId,
        messageId,
      });
      if (!url) {
        return apiError(c, 'bad_request', 'APP_URL or COOKIE_SIGNING_KEY is not configured.', 400);
      }
      return c.json({ url });
    },
  );

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

async function loadAssistContext(
  env: Env,
  workspaceId: string,
  ticketId: string,
): Promise<{ subject: string; customerLastMessage: string; memoryFacts: string[] } | null> {
  const ticket = await env.DB.prepare(
    `SELECT subject, customer_id FROM ticket WHERE id = ? AND workspace_id = ?`,
  )
    .bind(ticketId, workspaceId)
    .first<{ subject: string; customer_id: string | null }>();
  if (!ticket) return null;
  const lastInbound = await env.DB.prepare(
    `SELECT body_r2_key, preview FROM message_index
       WHERE workspace_id = ? AND ticket_id = ? AND direction = 'inbound'
       ORDER BY sent_at DESC LIMIT 1`,
  )
    .bind(workspaceId, ticketId)
    .first<{ body_r2_key: string | null; preview: string | null }>();
  const body = lastInbound?.body_r2_key
    ? ((await getText(env, lastInbound.body_r2_key)) ?? lastInbound.preview ?? '')
    : (lastInbound?.preview ?? '');
  let memoryFacts: string[] = [];
  if (ticket.customer_id) {
    const memory = await listMemory(env, workspaceId, ticket.customer_id);
    memoryFacts = memory.map((m) => `(${m.kind}) ${m.fact_text}`).slice(0, 5);
  }
  return { subject: ticket.subject, customerLastMessage: body, memoryFacts };
}
