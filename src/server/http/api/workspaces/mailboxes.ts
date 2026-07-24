import type { Hono } from 'hono';
import { apiError } from '../../../../lib/errors';
import {
  createWorkspaceMailbox,
  listWorkspaceMailboxes,
  updateWorkspaceMailbox,
} from '../../../platform/workspaces/admin';
import { createMailboxBody, updateMailboxBody } from '../../../schemas/workspaces';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from '../context';

export function registerWorkspaceMailboxRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/workspaces/current/mailboxes', async (c) => {
    const s = c.get('session');
    return c.json({ mailboxes: await listWorkspaceMailboxes(c.env, s.workspaceId) });
  });

  apiApp.post('/workspaces/current/mailboxes', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = createMailboxBody.parse(await c.req.json());
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

  apiApp.patch(
    '/workspaces/current/mailboxes/:id',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      const body = updateMailboxBody.parse(await c.req.json());
      const result = await updateWorkspaceMailbox(
        c.env,
        s.workspaceId,
        s.userId,
        c.req.param('id'),
        {
          displayName: body.display_name,
          autoReplyPolicy: body.auto_reply_policy,
          autonomyPolicy: body.autonomy_policy,
          autonomyThreshold: body.autonomy_threshold,
          autonomyRolloutPercent: body.autonomy_rollout_percent,
          defaultTeamId: body.default_team_id,
        },
      );
      if (result === 'not_found') return apiError(c, 'not_found', 'Mailbox not found.');
      return c.json({ ok: true });
    },
  );
}
