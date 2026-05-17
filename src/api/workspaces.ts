import type { Hono } from 'hono';
import { z } from 'zod';
import {
  createWorkspaceMailbox,
  listWorkspaceMailboxes,
  updateWorkspaceMailbox,
  workspaceAuditLog,
  workspaceExportManifest,
  workspaceUsage,
} from '../lib/workspace-admin';
import { sendWorkspaceInvitationEmail } from '../email/invitations';
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
} from '../lib/workspaces';
import { WORKSPACE_ROLES, type WorkspaceInvitation } from '../types/workspace';
import { OWNER_OR_ADMIN, requireWorkspaceRole, type Ctx } from './context';
import { apiError } from '../lib/errors';

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
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
    return c.json({ events: await workspaceAuditLog(c.env, s.workspaceId, limit) });
  });

  apiApp.get('/workspaces/current/export', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json(await workspaceExportManifest(c.env, s.workspaceId));
  });

  apiApp.get('/workspaces/current/mailboxes', async (c) => {
    const s = c.get('session');
    return c.json({ mailboxes: await listWorkspaceMailboxes(c.env, s.workspaceId) });
  });

  apiApp.post('/workspaces/current/mailboxes', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z.object({
      address: z.string().email(),
      display_name: z.string().max(100).optional(),
      auto_reply_policy: z.enum(['off', 'safe', 'always']).optional(),
    }).parse(await c.req.json());
    try {
      const mailbox = await createWorkspaceMailbox(c.env, s.workspaceId, s.userId, {
        address: body.address,
        displayName: body.display_name,
        autoReplyPolicy: body.auto_reply_policy,
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
    const body = z.object({
      display_name: z.string().max(100).nullable().optional(),
      auto_reply_policy: z.enum(['off', 'safe', 'always']).optional(),
    }).parse(await c.req.json());
    const result = await updateWorkspaceMailbox(c.env, s.workspaceId, s.userId, c.req.param('id'), {
      displayName: body.display_name,
      autoReplyPolicy: body.auto_reply_policy,
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
