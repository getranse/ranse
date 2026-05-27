export interface OutcomeStatementResponse {
  windowDays: number;
  windowStart: number;
  windowEnd: number;
  currency: string;
  valueCents: number;
  costCents: number;
  netCents: number;
  costPerVerifiedResolution: number | null;
  verifiedResolutionCount: number;
  finComparisonCents: number;
  roiRatio: number | null;
  breakdown: { kind: string; amountCents: number; count: number }[];
}

export interface PricingResponse {
  currency: string;
  inferenceCostCentsPer1kTokens: number;
  priceBook: {
    verified_resolution: number;
    autonomous_resolution: number;
    procedure_resolution: number;
    escalation: number;
    follow_up_cost: number;
    human_takeover_cost: number;
    inference_cost: number;
  };
  defaults: PricingResponse['priceBook'];
  updatedAt: number;
}
