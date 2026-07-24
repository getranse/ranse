# ADR-0001: Customer-owned, single-Worker deployment

**Status:** Accepted

## Context

Hosted AI support products (Fin, Decagon, Sierra) require customers to hand over their support
email, customer data, and provider spend to a vendor. A hosted control plane also means Ranse
would carry tenancy, billing, and compliance burdens from day one.

## Decision

Ranse ships as **one Cloudflare Worker app deployed to the customer's own account** via the
Deploy-to-Cloudflare button. There is no Ranse-hosted backend, telemetry, or sync. The repo
stays a single deployable unit — no monorepo tooling, no service splits.

## Consequences

- Data sovereignty is structural, not a policy promise; it is the core differentiator.
- Every feature must run within Workers limits (CPU time, D1, DO) — heavy work goes to Queues.
- One-click deploy is load-bearing: anything that breaks `wrangler deploy` from a fresh fork
  is a regression.
- Upgrades are `git pull` + migrations in the customer's fork; migrations must be forward-only
  and safe to apply in order (timestamp-prefixed filenames).
