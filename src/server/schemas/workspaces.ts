import { z } from 'zod';
import { AUTONOMY_POLICIES } from '../../types/shared/autonomy';
import { WORKSPACE_ROLES } from '../../types/shared/workspace';

export const mailboxBody = z.object({
  address: z.string().email().optional(),
  display_name: z.string().max(100).nullable().optional(),
  auto_reply_policy: z.enum(['off', 'safe', 'always']).optional(),
  autonomy_policy: z.enum(AUTONOMY_POLICIES).optional(),
  autonomy_threshold: z.number().min(0.5).max(0.99).optional(),
  autonomy_rollout_percent: z.number().min(0).max(100).optional(),
  default_team_id: z.string().nullable().optional(),
});

export const createMailboxBody = mailboxBody.extend({ address: z.string().email() });
export const updateMailboxBody = mailboxBody.omit({ address: true });

export const updateNameBody = z.object({ name: z.string().min(1).max(100) });
export const archiveConfirm = z.object({ confirm: z.literal('archive') });
export const deleteConfirm = z.object({ confirm: z.literal('delete') });
export const transferOwnershipBody = z.object({ user_id: z.string().min(1) });

export const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES),
});

export const roleBody = z.object({ role: z.enum(WORKSPACE_ROLES) });
