# 00 — Vision

## What Ranse is

An open-source, Cloudflare-native shared inbox that grows into a full autonomous
customer-service agent — deployed to the **customer's own Cloudflare account**, owned by them
from day one. Support email (and web channels) become tickets in a real-time multi-agent
workspace: triage, retrieval, drafting, procedures, MCP actions, and evals, with a human
approval gate in front of every outbound reply until the operator chooses otherwise.

## Why it exists

Commercial AI support agents (Fin, Decagon, Sierra) are hosted, opaque, and priced per
resolution. Ranse is the agent those products *structurally cannot become*:

- **Sovereign by construction** — no Ranse-hosted backend; data, secrets, and models stay in
  the customer's account.
- **Per-step model choice** — any provider via AI Gateway, per-action config, BYOK.
- **Procedures as code** — support workflows are versioned, reviewable, forkable specs, not a
  vendor's GUI state.
- **MCP-native actions** — external systems are reached through open protocol tools with
  guardrails, not a private connector marketplace.
- **Eval-first** — resolved conversations become anonymized replay cases; regressions are
  caught in CI, and the resolution metric is honest by design.
- **Forkable procedure library** — vetted workflows with provenance, evals, and reference MCP
  contracts that another company can fork.

## Who it serves

Small-to-mid support teams that want AI leverage without surrendering their customer data or
their email domain to a SaaS vendor — and developers who want a support agent they can read,
test, and extend.

## Non-goals

- **No hosted Ranse backend or SaaS control plane.** One-click deploy to the user's account is
  the distribution model.
- **No proprietary model.** Model quality is bought from providers; Ranse's edge is the
  harness (procedures, evals, guardrails), not weights.
- **No private connector marketplace.** MCP is the action surface.
- **No vanity CX score.** Metrics must measure what they claim (see honest resolution).
- **No paid console tier.** The operator console is fully open.

## Direction

The roadmap runs retrieval → workspace management → agentic retrieval → autonomous resolution
→ procedures → MCP actions → evals → procedure library → insights → multi-channel. See
[08-roadmap.md](08-roadmap.md) for phase status and what's next.
