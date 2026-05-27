import type { OutcomeStatementResponse, PricingResponse } from '../types/billing';
import { api } from './core';

export const billingApi = {
  outcomeStatement: (days = 30) =>
    api<{ statement: OutcomeStatementResponse }>(`/api/billing/statement?days=${days}`),
  pricing: () => api<{ pricing: PricingResponse }>('/api/billing/pricing'),
  updatePricing: (body: Partial<{
    priceBook: Partial<PricingResponse['priceBook']>;
    inferenceCostCentsPer1kTokens: number;
    currency: string;
  }>) =>
    api<{ pricing: PricingResponse }>('/api/billing/pricing', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
