import { z } from 'zod';

export const bootstrapBody = z.object({
  setup_token: z.string().min(1),
  workspace_name: z.string().min(1).max(100),
  admin_email: z.string().email(),
  admin_password: z.string().min(12),
  admin_name: z.string().min(1).max(100).optional(),
});

export const addMailboxBody = z.object({
  address: z.string().email(),
  display_name: z.string().max(100).optional(),
});

export const provisionBody = z.object({
  api_token: z.string().min(20),
  account_id: z.string().min(8),
  domain: z.string().min(3),
  mailbox_address: z.string().email(),
  worker_name: z.string().min(1).max(63),
});
