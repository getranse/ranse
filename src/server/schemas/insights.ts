import { z } from 'zod';
import { KNOWLEDGE_DRIFT_STATUSES } from '../../types/shared/insights';

export const limitSchema = z.object({ limit: z.number().int().min(1).max(500).optional() });
export const suggestionStatusSchema = z.object({ status: z.enum(['open', 'dismissed']) });
export const driftStatusSchema = z.object({ status: z.enum(KNOWLEDGE_DRIFT_STATUSES) });

export const markStaleBody = z.object({
  source_id: z.string().min(1),
  score: z.number().min(0).max(1),
  reason: z.string().max(500).optional(),
});

export const rejectProposalBody = z.object({ reason: z.string().min(1).max(500) });
