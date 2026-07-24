import type { Hono } from 'hono';
import { apiError } from '../../../lib/errors';
import type { WorkspaceInvitation } from '../../../types/shared/workspaces';
import { audit, auditContext } from '../../actions/audit';
import { sendWorkspaceInvitationEmail } from '../../inbox/email/invitations';
import { listWorkspaceOutcomeRollups } from '../../platform/outcomes';
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
} from '../../platform/workspaces';
import { workspaceExportManifest, workspaceUsage } from '../../platform/workspaces/admin';
import {
  archiveConfirm,
  deleteConfirm,
  inviteBody,
  roleBody,
  transferOwnershipBody,
  updateNameBody,
} from '../../schemas/workspaces';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';
import { registerWorkspaceAuditRoutes } from './workspaces-audit';
import { registerWorkspaceMailboxRoutes } from './workspaces-mailboxes';

export function registerWorkspaceRoutes(apiApp: Hono<Ctx>) {
  registerWorkspaceAuditRoutes(apiApp);
  registerWorkspaceMailboxRoutes(apiApp);
  apiApp.get('/workspaces/current/members', async (c) => {
    const s = c.get('session');
    return c.json({ members: await listWorkspaceMembers(c.env, s.workspaceId) });
  });

  apiApp.patch('/workspaces/current', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = updateNameBody.parse(await c.req.json());
    await updateWorkspaceName(c.env, s.workspaceId, s.userId, body.name);
    return c.json({ ok: true });
  });

  apiApp.post('/workspaces/current/archive', requireWorkspaceRole(['owner']), async (c) => {
    const s = c.get('session');
    archiveConfirm.parse(await c.req.json().catch(() => ({})));
    await archiveWorkspace(c.env, s.workspaceId, s.userId);
    return c.json({
      ok: true,
      currentWorkspaceId: await setSessionWorkspaceFallback(c.env, s.sessionId, s.userId),
    });
  });

  apiApp.delete('/workspaces/current', requireWorkspaceRole(['owner']), async (c) => {
    const s = c.get('session');
    deleteConfirm.parse(await c.req.json().catch(() => ({})));
    await deleteWorkspace(c.env, s.workspaceId, s.userId);
    return c.json({
      ok: true,
      currentWorkspaceId: await setSessionWorkspaceFallback(c.env, s.sessionId, s.userId),
    });
  });

  apiApp.post(
    '/workspaces/current/transfer-ownership',
    requireWorkspaceRole(['owner']),
    async (c) => {
      const s = c.get('session');
      const body = transferOwnershipBody.parse(await c.req.json());
      const result = await transferWorkspaceOwnership(c.env, s.workspaceId, s.userId, body.user_id);
      if (result === 'not_found')
        return apiError(c, 'not_found', 'Target user is not a workspace member.');
      return c.json({ ok: true });
    },
  );

  apiApp.get('/workspaces/current/usage', async (c) => {
    const s = c.get('session');
    return c.json({ usage: await workspaceUsage(c.env, s.workspaceId) });
  });

  apiApp.get(
    '/workspaces/current/outcomes/rollup',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
      return c.json({ days: await listWorkspaceOutcomeRollups(c.env, s.workspaceId, days) });
    },
  );

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

  apiApp.get('/workspaces/current/invitations', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const invitations = await listWorkspaceInvitations(c.env, s.workspaceId);
    return c.json({ invitations: invitations.map((item) => withAcceptUrl(c.req.url, item)) });
  });

  apiApp.post(
    '/workspaces/current/invitations',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const body = inviteBody.parse(await c.req.json());
      if (body.role === 'owner' && s.role !== 'owner') {
        return apiError(c, 'forbidden', 'Only owners can invite owners.');
      }
      const invitation = await createWorkspaceInvitation(
        c.env,
        s.workspaceId,
        s.userId,
        body.email,
        body.role,
      );
      const withUrl = withAcceptUrl(c.req.url, invitation);
      const emailDelivery = await sendWorkspaceInvitationEmail(
        c.env,
        s.workspaceId,
        body.email,
        withUrl.accept_url ?? '',
      ).catch(() => 'failed' as const);
      return c.json({ ok: true, invitation: withUrl, emailDelivery });
    },
  );

  apiApp.patch(
    '/workspaces/current/members/:userId',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const body = roleBody.parse(await c.req.json());
      const targetRole = await getMembershipRole(c.env, c.req.param('userId'), s.workspaceId);
      if (s.role !== 'owner' && (body.role === 'owner' || targetRole === 'owner')) {
        return apiError(c, 'forbidden', 'Only owners can change owner access.');
      }
      const result = await updateWorkspaceMemberRole(
        c.env,
        s.workspaceId,
        s.userId,
        c.req.param('userId'),
        body.role,
      );
      if (result === 'not_found') return apiError(c, 'not_found', 'Workspace member not found.');
      if (result === 'last_owner')
        return apiError(c, 'conflict', 'A workspace must keep at least one owner.');
      return c.json({ ok: true });
    },
  );

  apiApp.delete(
    '/workspaces/current/members/:userId',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      if (c.req.param('userId') === s.userId)
        return apiError(c, 'conflict', 'Use ownership transfer before removing yourself.');
      const targetRole = await getMembershipRole(c.env, c.req.param('userId'), s.workspaceId);
      if (s.role !== 'owner' && targetRole === 'owner')
        return apiError(c, 'forbidden', 'Only owners can remove owners.');
      const result = await removeWorkspaceMember(
        c.env,
        s.workspaceId,
        s.userId,
        c.req.param('userId'),
      );
      if (result === 'not_found') return apiError(c, 'not_found', 'Workspace member not found.');
      if (result === 'last_owner')
        return apiError(c, 'conflict', 'A workspace must keep at least one owner.');
      return c.json({ ok: true });
    },
  );
}

function withAcceptUrl(requestUrl: string, invitation: WorkspaceInvitation): WorkspaceInvitation {
  const url = new URL(requestUrl);
  url.pathname = `/invite/${invitation.token}`;
  url.search = '';
  url.hash = '';
  return { ...invitation, accept_url: url.toString() };
}
