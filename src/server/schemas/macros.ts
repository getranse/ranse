import { z } from 'zod';

export const createMacroBody = z.object({
  name: z.string().min(1).max(80),
  body: z.string().min(1).max(20000),
});

export const updateMacroBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    body: z.string().min(1).max(20000).optional(),
  })
  .refine((v) => v.name !== undefined || v.body !== undefined, {
    message: 'Provide name or body.',
  });
