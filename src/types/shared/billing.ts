import type { OutcomePriceBook, OutcomePricing, OutcomeLedgerEntry, OutcomeStatement } from '../../interfaces/billing';
export type { OutcomePriceBook, OutcomePricing, OutcomeLedgerEntry, OutcomeStatement };
export const OUTCOME_PRICING_KINDS = [
  'verified_resolution',
  'autonomous_resolution',
  'procedure_resolution',
  'escalation',
  'follow_up_cost',
  'human_takeover_cost',
  'inference_cost',
] as const;
export type OutcomePricingKind = (typeof OUTCOME_PRICING_KINDS)[number];

export const DEFAULT_PRICE_BOOK: OutcomePriceBook = {
  verified_resolution: 1500,
  autonomous_resolution: 500,
  procedure_resolution: 500,
  escalation: -200,
  follow_up_cost: -300,
  human_takeover_cost: -150,
  inference_cost: 0,
};

export const FIN_COMPARISON_CENTS_PER_RESOLUTION = 99;
