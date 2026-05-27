import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { ids } from '../../lib/ids';
import { apiError } from '../../lib/errors';
import { EVENTS, EVENT_NAMES, type EventName } from '../../notifications/events';
import { CHANNEL_KINDS, getHandler, listHandlers } from '../../notifications/channels';
import { OWNER_OR_ADMIN, type Ctx, requireWorkspaceRole } from './context';

export function registerNotificationRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/notifications/meta', async (c) => c.json({
    events: EVENT_NAMES.map((name) => ({ name, description: EVENTS[name].desc })),
    channels: listHandlers().map((h) => ({
      kind: h.kind,
      label: h.label,
      description: h.description,
      targetLabel: h.targetLabel,
      targetPlaceholder: h.targetPlaceholder,
    })),
  }));

  apiApp.get('/notifications/channels', async (c) => {
    const s = c.get('session');
    const rows = await c.env.DB.prepare(
      `SELECT id, kind, target, events, enabled, label, created_at
         FROM notification_channel WHERE workspace_id = ?
         ORDER BY created_at DESC`,
    )
      .bind(s.workspaceId)
      .all<{ id: string; kind: string; target: string; events: string; enabled: number; label: string | null; created_at: number }>();
    return c.json({ channels: (rows.results ?? []).map((r) => ({ ...r, enabled: r.enabled === 1, events: parseEvents(r.events) })) });
  });

  apiApp.post('/notifications/channels', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({
      kind: z.enum(CHANNEL_KINDS as [string, ...string[]]),
      target: z.string().min(1).max(2000),
      events: z.array(z.enum(EVENT_NAMES as [EventName, ...EventName[]])).min(1),
      label: z.string().max(100).optional(),
      enabled: z.boolean().optional(),
    }).parse(await c.req.json());

    const handler = getHandler(body.kind)!;
    const validationError = handler.validateTarget(body.target);
    if (validationError) return apiError(c, 'invalid_target', validationError);

    const id = ids.message().replace(/^msg_/, 'nch_');
    await c.env.DB.prepare(
      `INSERT INTO notification_channel (id, workspace_id, kind, target, events, enabled, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, s.workspaceId, body.kind, body.target, JSON.stringify(body.events),
        body.enabled === false ? 0 : 1, body.label ?? null, Date.now())
      .run();
    return c.json({ ok: true, id });
  });

  apiApp.patch('/notifications/channels/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({
      enabled: z.boolean().optional(),
      events: z.array(z.enum(EVENT_NAMES as [EventName, ...EventName[]])).min(1).optional(),
      label: z.string().max(100).nullable().optional(),
    }).parse(await c.req.json());

    const updates: string[] = [];
    const binds: any[] = [];
    if (body.enabled !== undefined) { updates.push('enabled = ?'); binds.push(body.enabled ? 1 : 0); }
    if (body.events !== undefined) { updates.push('events = ?'); binds.push(JSON.stringify(body.events)); }
    if (body.label !== undefined) { updates.push('label = ?'); binds.push(body.label); }
    if (updates.length === 0) return c.json({ ok: true });

    await c.env.DB.prepare(`UPDATE notification_channel SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`)
      .bind(...binds, c.req.param('id'), s.workspaceId)
      .run();
    return c.json({ ok: true });
  });

  apiApp.delete('/notifications/channels/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    await c.env.DB.prepare(`DELETE FROM notification_channel WHERE id = ? AND workspace_id = ?`)
      .bind(c.req.param('id'), s.workspaceId)
      .run();
    return c.json({ ok: true });
  });

  apiApp.post('/notifications/channels/:id/test', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const row = await c.env.DB.prepare(
      `SELECT kind, target FROM notification_channel WHERE id = ? AND workspace_id = ?`,
    )
      .bind(c.req.param('id'), s.workspaceId)
      .first<{ kind: string; target: string }>();
    if (!row) return apiError(c, 'not_found', 'Channel not found.');

    const handler = getHandler(row.kind);
    if (!handler) return apiError(c, 'unknown_kind', `Unknown channel kind: ${row.kind}`);
    try {
      await handler.deliver(c.env, row.target, await testNotificationPayload(c, s.workspaceId));
      return c.json({ ok: true });
    } catch (e) {
      return apiError(c, 'delivery_failed', e instanceof Error ? e.message : String(e));
    }
  });
}

function parseEvents(events: string): string[] {
  try { return JSON.parse(events); } catch { return []; }
}

async function testNotificationPayload(c: Context<Ctx>, workspaceId: string) {
  const mailbox = await c.env.DB.prepare(`SELECT address FROM mailbox WHERE workspace_id = ? LIMIT 1`)
    .bind(workspaceId)
    .first<{ address: string }>();
  return {
    name: 'ticket.created' as const,
    workspaceId,
    emittedAt: Date.now(),
    payload: {
      ticketId: 'test_ticket',
      subject: 'Hello from Ranse',
      requesterEmail: 'sender@example.com',
      requesterName: 'Test Sender',
      preview: 'This is a test notification — your channel is wired up correctly.',
      mailboxAddress: mailbox?.address ?? 'support@example.com',
      receivedAt: Date.now(),
    },
  };
}
