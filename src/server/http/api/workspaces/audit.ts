import type { Context, Hono } from 'hono';
import type { AuditCategory, AuditEventRecord, AuditQuery } from '../../../../types/shared/audit';
import { audit, auditContext, verifyAuditChain } from '../../../actions/audit';
import { workspaceAuditLog } from '../../../platform/workspaces/admin';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from '../context';

export function registerWorkspaceAuditRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/workspaces/current/audit', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json({
      events: await workspaceAuditLog(c.env, s.workspaceId, auditQueryFromRequest(c)),
    });
  });

  apiApp.get(
    '/workspaces/current/audit/export',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const events = await workspaceAuditLog(c.env, s.workspaceId, {
        ...auditQueryFromRequest(c),
        limit: 1000,
      });
      await audit(c.env, {
        workspaceId: s.workspaceId,
        actorType: 'user',
        actorId: s.userId,
        action: 'workspace.exported',
        payload: { kind: 'audit_log', count: events.length },
        context: auditContext(c),
      });
      if (c.req.query('format') === 'csv') {
        return new Response(auditEventsToCsv(events), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="audit-${s.workspaceId}-${Date.now()}.csv"`,
          },
        });
      }
      return c.json({ events });
    },
  );

  apiApp.get(
    '/workspaces/current/audit/verify',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      return c.json(await verifyAuditChain(c.env, s.workspaceId));
    },
  );
}

function auditQueryFromRequest(c: Context<Ctx>): AuditQuery {
  const num = (v: string | undefined) => (v ? Number(v) : undefined);
  return {
    action: c.req.query('action') || undefined,
    category: (c.req.query('category') as AuditCategory) || undefined,
    actorId: c.req.query('actor_id') || undefined,
    ticketId: c.req.query('ticket_id') || undefined,
    from: num(c.req.query('from')),
    to: num(c.req.query('to')),
    limit: num(c.req.query('limit')),
  };
}

const AUDIT_CSV_COLUMNS: (keyof AuditEventRecord)[] = [
  'created_at',
  'action',
  'category',
  'severity',
  'actor_type',
  'actor_id',
  'actor_email',
  'ip',
  'ticket_id',
  'request_id',
  'hash',
  'payload_json',
];

function auditEventsToCsv(events: AuditEventRecord[]): string {
  const escapeCsv = (value: unknown) => {
    const str = value == null ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [AUDIT_CSV_COLUMNS.join(',')];
  for (const event of events) {
    lines.push(AUDIT_CSV_COLUMNS.map((col) => escapeCsv(event[col])).join(','));
  }
  return lines.join('\n');
}
