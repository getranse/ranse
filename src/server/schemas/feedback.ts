import { z } from 'zod';

export const surveyBody = z.object({
  token: z.string().min(1),
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().default(''),
});
