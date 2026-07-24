# ADR-0003: Approval gates first, autonomy as a graduated ladder

**Status:** Accepted

## Context

AI support agents fail publicly when they act without oversight: hallucinated policies
(Air Canada, Cursor), jailbreaks, and email loops. Trust is earned per team, per mailbox — not
assumed.

## Decision

**Every AI-generated outbound reply is an approval request with edit-before-send** unless the
mailbox's autonomy gate explicitly passes. Autonomy is a per-mailbox ladder —
`draft_only → auto_send_if_confident → auto_send_always` — where "confident" is a composite
score (groundedness, retrieval strength, LLM confidence, chunk freshness) over a clamped
threshold, with hard blocks (spam/hostile/uncited/review-flagged) and a deterministic canary
rollout percentage. MCP write/destructive actions use the same approval queue.

## Consequences

- No code path may send customer-facing email without either an approval row or a passing
  autonomy evaluation; this is enforced in the supervisor, not left to model output.
- Draft-first is the default onboarding mode; teams graduate mailboxes deliberately.
- The approval queue is the audit anchor: every send traces to a human decision or a recorded
  gate evaluation (decision traces make this inspectable by the customer).
