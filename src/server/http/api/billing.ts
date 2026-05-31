import type { Hono } from 'hono';
import { z } from 'zod';
import {
  computeOutcomeStatement,
  loadPricing,
  priceBookFromRow,
  savePricing,
} from '../../platform/billing/outcomes';
import { OWNER_OR_ADMIN, requireWorkspaceRole, type Ctx } from './context';
import { DEFAULT_PRICE_BOOK } from '../../../types/shared/billing';

const priceBookSchema = z
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

const pricingUpdateSchema = z
  .object({
    priceBook: priceBookSchema.optional(),
    inferenceCostCentsPer1kTokens: z.number().int().min(0).optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

export function registerBillingRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/billing/pricing', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const row = await loadPricing(c.env, s.workspaceId);
    return c.json({
      pricing: {
        currency: row.currency,
        inferenceCostCentsPer1kTokens: row.inference_cost_cents_per_1k_tokens,
        priceBook: priceBookFromRow(row),
        defaults: DEFAULT_PRICE_BOOK,
        updatedAt: row.updated_at,
      },
    });
  });

  apiApp.put('/billing/pricing', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = pricingUpdateSchema.parse(await c.req.json());
    const saved = await savePricing(c.env, s.workspaceId, {
      priceBook: body.priceBook,
      inferenceCostCentsPer1kTokens: body.inferenceCostCentsPer1kTokens,
      currency: body.currency,
      actorUserId: s.userId,
    });
    return c.json({
      pricing: {
        currency: saved.currency,
        inferenceCostCentsPer1kTokens: saved.inference_cost_cents_per_1k_tokens,
        priceBook: priceBookFromRow(saved),
        defaults: DEFAULT_PRICE_BOOK,
        updatedAt: saved.updated_at,
      },
    });
  });

  apiApp.get('/billing/statement', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const windowDays = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
    return c.json({
      statement: await computeOutcomeStatement(c.env, s.workspaceId, { windowDays }),
    });
  });
}
