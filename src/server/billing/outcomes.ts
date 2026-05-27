import type { Env } from '../env';
import { ids } from '../lib/ids';
import { audit } from '../lib/audit';
import {
  DEFAULT_PRICE_BOOK,
  FIN_COMPARISON_CENTS_PER_RESOLUTION,
  type OutcomeLedgerEntry,
  type OutcomePriceBook,
  type OutcomePricing,
  type OutcomePricingKind,
  type OutcomeStatement,
  OUTCOME_PRICING_KINDS,
} from '../../types/billing';

// Outcome ledger. Each meaningful outcome event becomes a signed money amount
// against the workspace's price book. Reads of the ledger drive both the
// operations dashboard "cost per verified resolution" and any future hosted
// invoicing.

export async function loadPricing(env: Env, workspaceId: string): Promise<OutcomePricing> {
  const row = await env.DB.prepare(
    `SELECT workspace_id, config_json, inference_cost_cents_per_1k_tokens, currency, updated_at
       FROM workspace_outcome_pricing WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .first<OutcomePricing>();
  if (row) return row;
  // Synthesize defaults — we don't persist until the operator writes something.
  return {
    workspace_id: workspaceId,
    config_json: JSON.stringify(DEFAULT_PRICE_BOOK),
    inference_cost_cents_per_1k_tokens: 0,
    currency: 'USD',
    updated_at: 0,
  };
}

export function priceBookFromRow(row: OutcomePricing): OutcomePriceBook {
  try {
    const parsed = JSON.parse(row.config_json) as Partial<OutcomePriceBook>;
    return { ...DEFAULT_PRICE_BOOK, ...parsed };
  } catch {
    return DEFAULT_PRICE_BOOK;
  }
}

export async function savePricing(
  env: Env,
  workspaceId: string,
  input: {
    priceBook?: Partial<OutcomePriceBook>;
    inferenceCostCentsPer1kTokens?: number;
    currency?: string;
    actorUserId?: string;
  },
): Promise<OutcomePricing> {
  const existing = await loadPricing(env, workspaceId);
  const merged = { ...priceBookFromRow(existing), ...(input.priceBook ?? {}) };
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workspace_outcome_pricing (
       workspace_id, config_json, inference_cost_cents_per_1k_tokens, currency, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       config_json = excluded.config_json,
       inference_cost_cents_per_1k_tokens = excluded.inference_cost_cents_per_1k_tokens,
       currency = excluded.currency,
       updated_at = excluded.updated_at`,
  )
    .bind(
      workspaceId,
      JSON.stringify(merged),
      input.inferenceCostCentsPer1kTokens ?? existing.inference_cost_cents_per_1k_tokens,
      input.currency ?? existing.currency,
      now,
    )
    .run();
  await audit(env, {
    workspaceId,
    actorType: input.actorUserId ? 'user' : 'system',
    actorId: input.actorUserId,
    action: 'billing.pricing_updated',
    payload: { priceBook: merged },
  });
  return {
    workspace_id: workspaceId,
    config_json: JSON.stringify(merged),
    inference_cost_cents_per_1k_tokens:
      input.inferenceCostCentsPer1kTokens ?? existing.inference_cost_cents_per_1k_tokens,
    currency: input.currency ?? existing.currency,
    updated_at: now,
  };
}

export interface LedgerEntryInput {
  workspaceId: string;
  ticketId: string;
  outcomeEventId?: string | null;
  kind: OutcomePricingKind;
  // Override the price book — used for inference_cost which is a per-event
  // computed amount, not a fixed line item.
  amountCentsOverride?: number;
  metadata?: Record<string, unknown>;
}

export async function recordLedgerEntry(
  env: Env,
  input: LedgerEntryInput,
): Promise<OutcomeLedgerEntry | null> {
  const pricing = await loadPricing(env, input.workspaceId);
  const book = priceBookFromRow(pricing);
  const amount = input.amountCentsOverride ?? book[input.kind] ?? 0;
  if (amount === 0 && input.amountCentsOverride === undefined) {
    // Zero-priced kinds are explicitly opted out; don't pollute the ledger.
    return null;
  }
  const id = ids.outcomeLedgerEntry();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO outcome_ledger_entry (
       id, workspace_id, ticket_id, outcome_event_id, kind, amount_cents, currency,
       metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.ticketId,
      input.outcomeEventId ?? null,
      input.kind,
      amount,
      pricing.currency,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    )
    .run();
  return {
    id,
    workspace_id: input.workspaceId,
    ticket_id: input.ticketId,
    outcome_event_id: input.outcomeEventId ?? null,
    kind: input.kind,
    amount_cents: amount,
    currency: pricing.currency,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: now,
  };
}

export async function computeOutcomeStatement(
  env: Env,
  workspaceId: string,
  options: { windowDays?: number; now?: number } = {},
): Promise<OutcomeStatement> {
  const windowDays = Math.min(Math.max(options.windowDays ?? 30, 1), 365);
  const now = options.now ?? Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60_000;
  const pricing = await loadPricing(env, workspaceId);

  const breakdownRows = await env.DB.prepare(
    `SELECT kind, SUM(amount_cents) AS amount, COUNT(*) AS count
       FROM outcome_ledger_entry
      WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?
      GROUP BY kind`,
  )
    .bind(workspaceId, windowStart, now)
    .all<{ kind: OutcomePricingKind; amount: number; count: number }>();

  const breakdown = (breakdownRows.results ?? []).map((r) => ({
    kind: r.kind,
    amountCents: r.amount,
    count: r.count,
  }));

  let valueCents = 0;
  let costCents = 0;
  for (const row of breakdown) {
    if (row.amountCents > 0) valueCents += row.amountCents;
    else costCents += -row.amountCents;
  }
  const netCents = valueCents - costCents;
  const verifiedRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM verified_resolution
       WHERE workspace_id = ? AND status = 'verified' AND verified_at >= ? AND verified_at <= ?`,
  )
    .bind(workspaceId, windowStart, now)
    .first<{ n: number }>();
  const verifiedResolutionCount = verifiedRow?.n ?? 0;

  // Fin comparison: total outcomes that Fin would have billed against.
  // We count anything that resembles a resolved ticket: autonomous, procedure,
  // verified. The point is "what would Fin charge if you migrated here?"
  const finResolvedRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM verified_resolution
      WHERE workspace_id = ? AND ai_authored_at >= ? AND ai_authored_at <= ?
        AND status IN ('verified', 'pending')`,
  )
    .bind(workspaceId, windowStart, now)
    .first<{ n: number }>();
  const finCount = finResolvedRow?.n ?? 0;
  const finComparisonCents = finCount * FIN_COMPARISON_CENTS_PER_RESOLUTION;

  const costPerVerifiedResolution =
    verifiedResolutionCount > 0 ? costCents / verifiedResolutionCount : null;
  const roiRatio = costCents > 0 ? valueCents / costCents : null;

  return {
    windowDays,
    windowStart,
    windowEnd: now,
    currency: pricing.currency,
    valueCents,
    costCents,
    netCents,
    costPerVerifiedResolution,
    verifiedResolutionCount,
    finComparisonCents,
    roiRatio,
    breakdown,
  };
}

export async function listLedgerEntriesForTicket(
  env: Env,
  workspaceId: string,
  ticketId: string,
  limit = 50,
): Promise<OutcomeLedgerEntry[]> {
  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, ticket_id, outcome_event_id, kind, amount_cents, currency,
            metadata_json, created_at
       FROM outcome_ledger_entry
      WHERE workspace_id = ? AND ticket_id = ?
      ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(workspaceId, ticketId, Math.min(Math.max(limit, 1), 200))
    .all<OutcomeLedgerEntry>();
  return rows.results ?? [];
}

// Map an outcome event kind to the price-book key used when we record a
// ledger entry. Kept here (not in lib/outcomes) so the billing module owns the
// pricing translation and the outcome module stays pricing-agnostic.
export function ledgerKindForOutcome(
  kind: 'resolved_autonomously' | 'resolved_via_procedure' | 'escalated' | 'customer_followed_up',
): OutcomePricingKind | null {
  switch (kind) {
    case 'resolved_autonomously':
      return 'autonomous_resolution';
    case 'resolved_via_procedure':
      return 'procedure_resolution';
    case 'escalated':
      return 'escalation';
    case 'customer_followed_up':
      return 'follow_up_cost';
    default:
      return null;
  }
}

export function validatePricingKind(kind: string): kind is OutcomePricingKind {
  return (OUTCOME_PRICING_KINDS as readonly string[]).includes(kind);
}
