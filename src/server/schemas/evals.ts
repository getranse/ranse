import { z } from 'zod';
import { EVAL_CASE_STATUSES, EVAL_RUN_SOURCES } from '../../types/shared/evals';

const anonymizationSchema = z
  .object({
    redactEmails: z.boolean().optional(),
    redactPhones: z.boolean().optional(),
    redactRequesterName: z.boolean().optional(),
  })
  .optional();

export const caseStatusPatch = z.object({ status: z.enum(EVAL_CASE_STATUSES) });

export const captureResolvedBody = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  anonymization: anonymizationSchema,
});

export const runEvalBody = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  case_ids: z.array(z.string()).max(500).optional(),
  threshold: z.number().min(0.05).max(0.95).optional(),
  score_drop_threshold: z.number().min(0.01).max(0.75).optional(),
  source: z.enum(EVAL_RUN_SOURCES).optional(),
});
