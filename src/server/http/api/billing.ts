import type { Hono } from 'hono';
import { DEFAULT_PRICE_BOOK } from '../../../types/shared/billing';
import {
  computeOutcomeStatement,
  loadPricing,
  priceBookFromRow,
  savePricing,
} from '../../platform/billing/outcomes';
import { pricingUpdateBody } from '../../schemas/billing';
import { type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

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
    const body = pricingUpdateBody.parse(await c.req.json());
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
