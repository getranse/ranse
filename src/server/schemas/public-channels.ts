import { z } from 'zod';

export const startSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().max(120).optional(),
  subject: z.string().max(180).optional(),
  message: z.string().min(1).max(5000),
  visitor_id: z.string().max(160).nullable().optional(),
  company: z.string().max(200).optional(),
});

export const messageSchema = z.object({
  message: z.string().min(1).max(5000),
  company: z.string().max(200).optional(),
});
