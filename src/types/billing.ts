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

export interface OutcomePriceBook {
  // Signed values in cents. Positive = value delivered to the workspace,
  // negative = cost. The defaults below are based on the industry-comparator
  // story: a $15 verified resolution value vs Fin's $0.99 charged price,
  // with realistic costs for the failure modes the verified resolution model
  // explicitly catches.
  verified_resolution: number;
  autonomous_resolution: number;
  procedure_resolution: number;
  escalation: number;
  follow_up_cost: number;
  human_takeover_cost: number;
  inference_cost: number;
}

export const DEFAULT_PRICE_BOOK: OutcomePriceBook = {
  verified_resolution: 1500,
  autonomous_resolution: 500,
  procedure_resolution: 500,
  escalation: -200,
  follow_up_cost: -300,
  human_takeover_cost: -150,
  inference_cost: 0,
};

export interface OutcomePricing {
  workspace_id: string;
  config_json: string;
  inference_cost_cents_per_1k_tokens: number;
  currency: string;
  updated_at: number;
}

export interface OutcomeLedgerEntry {
  id: string;
  workspace_id: string;
  ticket_id: string;
  outcome_event_id: string | null;
  kind: OutcomePricingKind;
  amount_cents: number;
  currency: string;
  metadata_json: string | null;
  created_at: number;
}

export interface OutcomeStatement {
  windowDays: number;
  windowStart: number;
  windowEnd: number;
  currency: string;
  // Value delivered: sum of positive entries.
  valueCents: number;
  // Cost: absolute value of summed negative entries.
  costCents: number;
  netCents: number;
  // Cost per verified resolution — the "Honest Resolution unit economics" number.
  costPerVerifiedResolution: number | null;
  verifiedResolutionCount: number;
  // Comparison: what Fin's $0.99 / resolution model would bill against this
  // workspace's Fin-style resolution count.
  finComparisonCents: number;
  // Ratio of value to absolute cost.
  roiRatio: number | null;
  breakdown: { kind: OutcomePricingKind; amountCents: number; count: number }[];
}

export const FIN_COMPARISON_CENTS_PER_RESOLUTION = 99;
