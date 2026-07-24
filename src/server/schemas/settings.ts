import { z } from 'zod';

export const workspaceSettingsBody = z.object({
  ai_drafts_enabled: z.boolean().optional(),
  audit_read_logging: z.boolean().optional(),
  from_name: z.string().max(100).optional(),
  logo_url: z.union([z.string().url().max(500), z.literal('')]).optional(),
});

export const agentProfileBody = z.object({
  name: z.string().max(100).optional(),
  signature_markdown: z.string().max(5000).optional(),
  avatar_url: z.union([z.string().url().max(500), z.literal('')]).optional(),
});
