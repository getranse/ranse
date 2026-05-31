import { z } from 'zod';
import { KNOWLEDGE_SEARCH_SCOPES } from '../../types/shared/knowledge';

export const PlannerSchema = z.object({
  scope: z.enum(KNOWLEDGE_SEARCH_SCOPES).default('all'),
  subqueries: z.array(z.string().min(1).max(500)).min(1).max(5),
  max_hops: z.number().int().min(1).max(5).default(3),
});

export const JudgmentSchema = z.object({
  sufficient: z.boolean(),
  reasoning: z.string().default(''),
  missing: z.array(z.string()).default([]),
  next_query: z.string().max(500).optional(),
});

export const RewriteSchema = z.object({ query: z.string().min(1).max(500) });
