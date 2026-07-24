import { z } from 'zod';

export const createTagBody = z.object({
  name: z.string().min(1).max(48),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const assignTagBody = z.object({ tagId: z.string().min(1) });
