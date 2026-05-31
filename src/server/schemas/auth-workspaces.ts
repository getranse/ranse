import { z } from 'zod';

export const createWorkspaceBody = z.object({ name: z.string().min(1).max(100) });
export const switchWorkspaceBody = z.object({ workspace_id: z.string().min(1) });
export const acceptInvitationBody = z.object({ token: z.string().min(20) });
