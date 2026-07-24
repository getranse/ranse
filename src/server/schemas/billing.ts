import { z } from 'zod';

export const priceBookSchema = z
  .object({
    verified_resolution: z.number().int().optional(),
    autonomous_resolution: z.number().int().optional(),
    procedure_resolution: z.number().int().optional(),
    escalation: z.number().int().optional(),
    follow_up_cost: z.number().int().optional(),
    human_takeover_cost: z.number().int().optional(),
    inference_cost: z.number().int().optional(),
  })
  .strict();

export const pricingUpdateBody = z
  .object({
    priceBook: priceBookSchema.optional(),
    inferenceCostCentsPer1kTokens: z.number().int().min(0).optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();
