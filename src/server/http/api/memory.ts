import type { Hono } from 'hono';
import { listMemory, redactMemory, upsertMemory } from '../../actions/memory';
import { apiError } from '../../../lib/errors';
import { audit, auditContext, isReadLoggingEnabled } from '../../actions/audit';
import { CAN_WORK_TICKETS, requireWorkspaceRole, type Ctx } from './context';
import { createBody, redactBody } from '../../schemas/memory';

// Operator-facing memory CRUD. Reads are open to anyone who can work
// tickets; redaction requires the same role (it doesn't delete data, only
// marks it redacted so audit trails stay intact). Operator-created notes
// always carry created_by='operator' so the extractor never overwrites
// them with a lower-confidence inference.

export function registerMemoryRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/memory/customers/:id', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const customerId = c.req.param('id');
    const memory = await listMemory(c.env, s.workspaceId, customerId);
    // PII read-access logging (opt-in per workspace; high-volume so off by default).
    if (await isReadLoggingEnabled(c.env, s.workspaceId)) {
      await audit(c.env, {
        workspaceId: s.workspaceId,
        actorType: 'user',
        actorId: s.userId,
        action: 'data.customer_memory_viewed',
        payload: { customerId, count: memory.length },
        context: auditContext(c),
      });
    }
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
