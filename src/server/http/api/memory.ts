import type { Hono } from 'hono';
import { z } from 'zod';
import { listMemory, redactMemory, upsertMemory } from '../../memory/store';
import { apiError } from '../../lib/errors';
import { CAN_WORK_TICKETS, requireWorkspaceRole, type Ctx } from './context';

// Operator-facing memory CRUD. Reads are open to anyone who can work
// tickets; redaction requires the same role (it doesn't delete data, only
// marks it redacted so audit trails stay intact). Operator-created notes
// always carry created_by='operator' so the extractor never overwrites
// them with a lower-confidence inference.

const createBody = z.object({
  customer_id: z.string().min(1),
  fact_text: z.string().min(2).max(600),
  kind: z
    .enum(['fact', 'preference', 'context', 'complaint', 'communication_style'])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const redactBody = z.object({ reason: z.string().min(2).max(240) });

export function registerMemoryRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/memory/customers/:id', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const memory = await listMemory(c.env, s.workspaceId, c.req.param('id'));
    return c.json({ memory });
  });

  apiApp.post('/memory/customers/:id', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = createBody.parse(await c.req.json());
    if (body.customer_id !== c.req.param('id')) {
      return apiError(c, 'validation_error', 'customer_id mismatch.', 400);
    }
    const memory = await upsertMemory(c.env, {
      workspaceId: s.workspaceId,
      customerId: body.customer_id,
      kind: body.kind ?? 'fact',
      factText: body.fact_text,
      confidence: body.confidence ?? 0.95,
      createdBy: 'operator',
    });
    return c.json({ memory });
  });

  apiApp.post(
    '/memory/customers/:customerId/redact/:memoryId',
    requireWorkspaceRole(CAN_WORK_TICKETS),
    async (c) => {
      const s = c.get('session');
      const body = redactBody.parse(await c.req.json());
      await redactMemory(c.env, s.workspaceId, c.req.param('memoryId'), body.reason);
      return c.json({ ok: true });
    },
  );
}
