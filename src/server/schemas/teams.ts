import { z } from 'zod';

export const createTeamBody = z.object({ name: z.string().min(1).max(64) });

export const teamMemberBody = z.object({ userId: z.string().min(1) });
