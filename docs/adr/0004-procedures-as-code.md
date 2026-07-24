# ADR-0004: Procedures as code, not GUI state

**Status:** Accepted

## Context

Support workflows in commercial tools live as opaque GUI configuration — unversionable,
unreviewable, unforkable. Raw prompts are unpredictable; decision trees are brittle. The
industry pattern that works (Decagon's AOPs, Fin's Procedures) is natural-language authoring
with code-rigor execution.

## Decision

Procedures are **YAML/JSON/TS specs with immutable published versions**, executed by a
dedicated `ProcedureRunnerAgent` Durable Object with D1 checkpoints. The primitive set is
closed (`ask_customer`, `search`, `add_note`, `escalate_to`, `set_ticket_field`,
`call_action`, `wait_for_event`, `if`, `loop`); external effects go through MCP tools with
guardrails. Every library procedure ships with inline evals, provenance checksums, and
reference MCP contracts, and is validated by `ranse procedure validate-library` and CI.

## Consequences

- Workflows are reviewable in PRs, testable in CI (`ranse eval`), and forkable across
  companies — the procedure library and marketplace depend on this.
- Sensitive steps stay deterministic: eligibility checks and destructive actions are code and
  approval gates, never model discretion.
- The closed primitive set is a feature: new capabilities arrive as MCP tools or new vetted
  primitives, not ad-hoc script escape hatches.
