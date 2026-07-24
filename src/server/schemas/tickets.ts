import { z } from 'zod';
import { FEEDBACK_RATINGS } from '../../types/shared/autonomy';

export const assignBody = z.object({ userId: z.string().nullable() });

export const statusBody = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed', 'spam']),
});

export const noteBody = z.object({ body: z.string().min(1).max(20000) });

export const replyBody = z.object({
  body: z.string().min(1).max(50000),
  subject: z.string().max(998).optional(),
  cited_knowledge_ids: z.array(z.string()).max(20).optional(),
});

export const draftAssistBody = z.object({
  draft: z.string().max(50_000),
  cursor: z.number().int().min(0).max(50_000).optional(),
});

export const aiDraftsBody = z.object({ enabled: z.boolean().nullable() });

export const feedbackBody = z.object({
  rating: z.enum(FEEDBACK_RATINGS),
  message_id: z.string().nullable().optional(),
  comment: z.string().max(2000).nullable().optional(),
});

export const mergeBody = z.object({ sourceTicketId: z.string().min(1) });
