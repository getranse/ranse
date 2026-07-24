import { z } from 'zod';

export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

export const totpCodeBody = z.object({ code: z.string().min(6).max(8) });
