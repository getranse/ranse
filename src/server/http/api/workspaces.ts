import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  createWorkspaceMailbox,
  listWorkspaceMailboxes,
  updateWorkspaceMailbox,
  workspaceAuditLog,
  workspaceExportManifest,
  workspaceUsage,
} from '../../workspaces/admin';
import { listWorkspaceOutcomeRollups } from '../../outcomes';
import { sendWorkspaceInvitationEmail } from '../../email/invitations';
import {
  archiveWorkspace,
  createWorkspaceInvitation,
  deleteWorkspace,
  getMembershipRole,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  removeWorkspaceMember,
  setSessionWorkspaceFallback,
  transferWorkspaceOwnership,
  updateWorkspaceMemberRole,
  updateWorkspaceName,
} from '../../workspaces';
import { WORKSPACE_ROLES, type WorkspaceInvitation } from '../../../types/workspace';
import { AUTONOMY_POLICIES } from '../../../types/autonomy';
import { OWNER_OR_ADMIN, requireWorkspaceRole, type Ctx } from './context';
import { apiError } from '../../lib/errors';
import { audit, auditContext, verifyAuditChain } from '../../lib/audit';
import type { AuditCategory, AuditEventRecord, AuditQuery } from '../../../types/audit';

const mailboxBody = z.object({
  address: z.string().email().optional(),
  display_name: z.string().max(100).nullable().optional(),
  auto_reply_policy: z.enum(['off', 'safe', 'always']).optional(),
  autonomy_policy: z.enum(AUTONOMY_POLICIES).optional(),
  autonomy_threshold: z.number().min(0.5).max(0.99).optional(),
  autonomy_rollout_percent: z.number().min(0).max(100).optional(),
});

export function registerWorkspaceRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/workspaces/current/members', async (c) => {
    const s = c.get('session');
    return c.json({ members: await listWorkspaceMembers(c.env, s.workspaceId) });
  });

  apiApp.patch('/workspaces/current', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({ name: z.string().min(1).max(100) }).parse(await c.req.json());
    await updateWorkspaceName(c.env, s.workspaceId, s.userId, body.name);
    return c.json({ ok: true });
  });

  apiApp.post('/workspaces/current/archive', requireWorkspaceRole(['owner']), async (c) => {
    const s = c.get('session');
    z.object({ confirm: z.literal('archive') }).parse(await c.req.json().catch(() => ({})));
    await archiveWorkspace(c.env, s.workspaceId, s.userId);
    return c.json({ ok: true, currentWorkspaceId: await setSessionWorkspaceFallback(c.env, s.sessionId, s.userId) });
  });

  apiApp.delete('/workspaces/current', requireWorkspaceRole(['owner']), async (c) => {
    const s = c.get('session');
    z.object({ confirm: z.literal('delete') }).parse(await c.req.json().catch(() => ({})));
    await deleteWorkspace(c.env, s.workspaceId, s.userId);
    return c.json({ ok: true, currentWorkspaceId: await setSessionWorkspaceFallback(c.env, s.sessionId, s.userId) });
  });

  apiApp.post('/workspaces/current/transfer-ownership', requireWorkspaceRole(['owner']), async (c) => {
    const s = c.get('session');
    const body = z.object({ user_id: z.string().min(1) }).parse(await c.req.json());
    const result = await transferWorkspaceOwnership(c.env, s.workspaceId, s.userId, body.user_id);
    if (result === 'not_found') return apiError(c, 'not_found', 'Target user is not a workspace member.');
    return c.json({ ok: true });
  });

  apiApp.get('/workspaces/current/usage', async (c) => {
    const s = c.get('session');
    return c.json({ usage: await workspaceUsage(c.env, s.workspaceId) });
  });

  apiApp.get('/workspaces/current/audit', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json({ events: await workspaceAuditLog(c.env, s.workspaceId, auditQueryFromRequest(c)) });
  });

  apiApp.get('/workspaces/current/audit/export', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
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
  });

  apiApp.get('/workspaces/current/audit/verify', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json(await verifyAuditChain(c.env, s.workspaceId));
  });

  apiApp.get('/workspaces/current/outcomes/rollup', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
    return c.json({ days: await listWorkspaceOutcomeRollups(c.env, s.workspaceId, days) });
  });

  apiApp.get('/workspaces/current/export', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const manifest = await workspaceExportManifest(c.env, s.workspaceId);
    await audit(c.env, {
      workspaceId: s.workspaceId,
      actorType: 'user',
      actorId: s.userId,
      action: 'workspace.exported',
      payload: { kind: 'workspace_manifest' },
      context: auditContext(c),
    });
    return c.json(manifest);
  });

  apiApp.get('/workspaces/current/mailboxes', async (c) => {
    const s = c.get('session');
    return c.json({ mailboxes: await listWorkspaceMailboxes(c.env, s.workspaceId) });
  });

  apiApp.post('/workspaces/current/mailboxes', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = mailboxBody.extend({ address: z.string().email() }).parse(await c.req.json());
    try {
      const mailbox = await createWorkspaceMailbox(c.env, s.workspaceId, s.userId, {
        address: body.address,
        displayName: body.display_name,
        autoReplyPolicy: body.auto_reply_policy,
        autonomyPolicy: body.autonomy_policy,
        autonomyThreshold: body.autonomy_threshold,
        autonomyRolloutPercent: body.autonomy_rollout_percent,
      });
      return c.json({ ok: true, mailbox });
    } catch (err) {
      if (err instanceof Error && err.message === 'mailbox_address_already_exists') {
        return apiError(c, 'conflict', 'That mailbox address is already in use.');
      }
      throw err;
    }
  });

  apiApp.patch('/workspaces/current/mailboxes/:id', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = mailboxBody.omit({ address: true }).parse(await c.req.json());
    const result = await updateWorkspaceMailbox(c.env, s.workspaceId, s.userId, c.req.param('id'), {
      displayName: body.display_name,
      autoReplyPolicy: body.auto_reply_policy,
      autonomyPolicy: body.autonomy_policy,
      autonomyThreshold: body.autonomy_threshold,
      autonomyRolloutPercent: body.autonomy_rollout_percent,
    });
    if (result === 'not_found') return apiError(c, 'not_found', 'Mailbox not found.');
    return c.json({ ok: true });
  });

  apiApp.get('/workspaces/current/invitations', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const invitations = await listWorkspaceInvitations(c.env, s.workspaceId);
    return c.json({ invitations: invitations.map((item) => withAcceptUrl(c.req.url, item)) });
  });

  apiApp.post('/workspaces/current/invitations', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({
      email: z.string().email(),
      role: z.enum(WORKSPACE_ROLES),
    }).parse(await c.req.json());
    if (body.role === 'owner' && s.role !== 'owner') {
      return apiError(c, 'forbidden', 'Only owners can invite owners.');
    }
    const invitation = await createWorkspaceInvitation(c.env, s.workspaceId, s.userId, body.email, body.role);
    const withUrl = withAcceptUrl(c.req.url, invitation);
    const emailDelivery = await sendWorkspaceInvitationEmail(c.env, s.workspaceId, body.email, withUrl.accept_url ?? '')
      .catch(() => 'failed' as const);
    return c.json({ ok: true, invitation: withUrl, emailDelivery });
  });

  apiApp.patch('/workspaces/current/members/:userId', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({ role: z.enum(WORKSPACE_ROLES) }).parse(await c.req.json());
    const targetRole = await getMembershipRole(c.env, c.req.param('userId'), s.workspaceId);
    if (s.role !== 'owner' && (body.role === 'owner' || targetRole === 'owner')) {
      return apiError(c, 'forbidden', 'Only owners can change owner access.');
    }
    const result = await updateWorkspaceMemberRole(c.env, s.workspaceId, s.userId, c.req.param('userId'), body.role);
    if (result === 'not_found') return apiError(c, 'not_found', 'Workspace member not found.');
    if (result === 'last_owner') return apiError(c, 'conflict', 'A workspace must keep at least one owner.');
    return c.json({ ok: true });
  });

  apiApp.delete('/workspaces/current/members/:userId', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    if (c.req.param('userId') === s.userId) return apiError(c, 'conflict', 'Use ownership transfer before removing yourself.');
    const targetRole = await getMembershipRole(c.env, c.req.param('userId'), s.workspaceId);
    if (s.role !== 'owner' && targetRole === 'owner') return apiError(c, 'forbidden', 'Only owners can remove owners.');
    const result = await removeWorkspaceMember(c.env, s.workspaceId, s.userId, c.req.param('userId'));
    if (result === 'not_found') return apiError(c, 'not_found', 'Workspace member not found.');
    if (result === 'last_owner') return apiError(c, 'conflict', 'A workspace must keep at least one owner.');
    return c.json({ ok: true });
  });
}

function withAcceptUrl(requestUrl: string, invitation: WorkspaceInvitation): WorkspaceInvitation {
  const url = new URL(requestUrl);
  url.pathname = `/invite/${invitation.token}`;
  url.search = '';
  url.hash = '';
  return { ...invitation, accept_url: url.toString() };
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
  const escape = (value: unknown) => {
    const str = value == null ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [AUDIT_CSV_COLUMNS.join(',')];
  for (const event of events) {
    lines.push(AUDIT_CSV_COLUMNS.map((col) => escape(event[col])).join(','));
  }
  return lines.join('\n');
}
