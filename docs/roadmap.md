# Roadmap

> **Directional, not committed.** This is the planned shape of Ranse, not a fixed schedule. Phase order and scope will shift based on contributor interest, real-world feedback from self-hosters, and what we learn building each phase. If you want to work on something further down the list, open a discussion — we'll happily reorder.

## North star

Ranse is **not** trying to be an open-source clone of [Fin](https://fin.ai/) or [Decagon](https://decagon.ai/). It's trying to be the customer-service AI agent those products **structurally cannot become**, because their business shape rules it out.

The thesis: a closed SaaS agent has to charge per outcome, lock the connector ecosystem, ship one model, and keep procedures inside its UI. Those constraints are revenue features, not technical limits. An OSS agent built on Cloudflare primitives is free of all four — and that creates room for a category of features Fin/Decagon will never ship.

## Principles (the things Fin can't do)

Every phase below is derived from one of these. If a feature doesn't connect back to one of them, we probably shouldn't build it.

### 1. Sovereign by construction
Every byte — tickets, KB chunks, embeddings, prompts, traces — stays inside the customer's own Cloudflare account. With Workers AI a workspace can run **zero third-party LLM providers**. This is the only viable answer for EU, healthcare, finance, gov, and any buyer with a procurement team. Fin's architecture cannot offer this.

### 2. Per-step model choice
LLM calls go through `src/llm/` and the AI Gateway `/compat` endpoint. That means a workspace picks the model **per agent step**: Haiku for triage classification, Opus for multi-turn procedures, Workers AI Llama for routine drafts, OpenRouter for everything else. Cost and quality optimization that's structurally impossible on a closed-stack agent locked to one in-house model.

### 3. Procedures as code, not as UI
Procedures live as YAML/TS files in the workspace's own repo, committed and PR-reviewed. Diff'able, testable, rollback-able, code-reviewable by the people who actually understand the business logic — engineers. Fin's procedures are trapped in their authoring UI; ours are first-class git artifacts.

### 4. MCP-native actions
Actions are MCP tool calls, full stop. Any MCP server the customer's eng team has built — internal admin tools, billing systems, account-recovery scripts — becomes an agent action without us writing a connector. We ship a few first-party MCP servers (Stripe, Shopify, GitHub, Linear) but the architecture is the open protocol, not a private connector marketplace. Fin's connector business model can't pivot to this.

### 5. Eval-first, against your own history
Every prompt or procedure change runs against the workspace's own historical resolved tickets as eval cases — anonymized and replayed end-to-end. You cannot ship a change that regresses past resolutions. Fin has "Simulations" but they're synthetic; we evaluate against the buyer's actual past customers.

### 6. Forkable procedure library
A public, community-maintained library of procedures (refund flows, password reset, shipping disputes, subscription cancellation, fraud triage) that workspaces fork into their repo and customize. Network effects a closed-SaaS competitor cannot replicate, because their customers have no incentive to share private procedures with each other through a vendor.

### 7. Email-first, not chat-retrofitted
Most "AI agent" tools are chat shaped and bolt email on. Real B2B support lives in email — multi-day threads, quoting, signatures, attachments, CC chains, SLA on hours-to-days, not seconds. Ranse treats email as the primary surface and chat/voice as derivatives. Threading semantics, quote handling, and signature stripping are first-class concerns, not afterthoughts.

## Where we are

**Phase 0 — Bootstrap** is shipped. One-click deploy, setup wizard, inbound email via Email Routing, `WorkspaceSupervisorAgent` DO orchestrating `triage → knowledge → draft → approval`, multi-provider LLM dispatcher (`src/llm/`), human approval gate before send, notification channels (`src/notifications/`).

That's roughly an early Fin **Copilot** equivalent — assistive drafting for human agents. Everything below is the path from copilot to autonomous agent built around the seven principles above.

## Phase 1 — Retrieval foundations
*Principle 1 (sovereign), Principle 5 (eval-first feeds on this)*

The floor. Without real retrieval, every later phase is hand-waving.

- Vectorize index per workspace; embeddings via Workers AI
- Ingest sources: help-center URLs (crawl + chunk), PDFs in R2, **resolved tickets** (mine your own historical replies — highest-signal source, free for us because we already store them)
- Two-stage retrieve → rerank pipeline; reranker model selectable per workspace
- Content Library UI: sources, last-crawled, "used in N answers", staleness flags, dedupe warnings
- "Answer Inspection" in operator console — every draft shows which chunks grounded it, click-through to source
- **Stays in your account** — no embeddings ever leave the workspace's Cloudflare tenant

## Phase 2 — Agentic retrieval (multi-hop)
*Principle 2 (per-step model), Principle 5 (eval cases test the loop)*

Single-pass RAG fails on the hard tickets — the ones where the customer's question implies three sub-questions, or the answer requires combining a help-center article with a piece of account state. This is where Fin's lead is real and where naive OSS RAG loses. Closing it is its own phase, not a footnote on Phase 1.

- **Retrieval planner**: an LLM step that decomposes the customer query into sub-queries before searching, and picks the search scope (KB only / resolved tickets / customer data via MCP / all)
- **Sufficiency judge**: after each hop, an LLM step decides "do I have enough to answer, or do I need another search?" — bounded by a max-hops budget per autonomy level
- **Query rewriting per hop**: failed/sparse results trigger a reformulation, not a give-up
- **Per-hop model routing** (Principle 2): cheap model for rewrites, stronger model for sufficiency judgment, strongest for final synthesis. Three different models in one resolution is normal, not exotic
- **`search` as a procedure primitive** (Principle 3): Phase 4 procedures can call `search(query, scope, max_hops)` as a step, with the same agentic loop — procedures don't have to pre-bake every fact they need
- **Answer Inspection shows the trace**: every hop's query → results → judgment → next-query is visible to the operator. Critical for debugging hallucinations and for Phase 6 evals
- **Eval cases test the loop, not just the final answer** (Principle 5): a regression that adds an extra unnecessary hop is a regression, even if the final answer is correct

## Phase 3 — Autonomous resolution + per-step model routing
*Principle 1, Principle 2*

- Per-mailbox autonomy: `draft-only` / `auto-send-if-confidence-above-threshold` / `auto-send-always`
- Confidence scoring (groundedness + reranker score + LLM self-report + retrieved-chunk freshness)
- **Per-step model config** in workspace settings: `triage.model`, `draft.model`, `procedure_step.model` etc., each independently swappable
- Outcome event model in D1 — `resolved-autonomously`, `resolved-via-procedure`, `escalated`, `customer-followed-up` — primitive for Phase 6 (evals) and Phase 8 (insights)
- Customer feedback hooks (thumbs up/down, follow-up detection)

## Phase 4 — Procedures as code
*Principle 3 — the biggest single differentiator*

- Procedures defined as YAML or TS files in `procedures/` directory of the workspace's repo
- Schema includes: trigger, steps (NL + deterministic), version, owner, eval cases
- Procedure runner as a Durable Object — checkpointed, resumable across multi-day customer turns
- Step primitives: `ask_customer`, `call_action` (MCP tool), `search` (Phase 2 loop), `escalate_to(team)`, `set_ticket_field`, `wait_for_event`, `if/else`, `loop`
- **GitOps deploy**: PR merges to `main` → procedures auto-published to the workspace; previous version stays addressable for in-flight conversations
- `ranse simulate <procedure>` CLI for local dry-run before opening the PR

## Phase 5 — MCP-native actions
*Principle 4*

- Actions are exclusively MCP tool calls — no bespoke connector framework
- Workspace registers MCP servers via URL + auth in settings; tool list auto-discovered
- First-party MCP servers shipped in-repo: Stripe (refunds, sub lookup), Shopify (orders), GitHub, Linear, generic webhook
- Per-tool guardrails: requires-approval, dollar limits, allowed customer segments, rate limits — enforced in the runner, not by the MCP server
- Read vs. write distinction surfaced in procedure authoring + audit log

## Phase 6 — Eval against your own ticket history
*Principle 5*

- Every resolved conversation captured as a replayable eval case (anonymized, configurable PII rules)
- `ranse eval` runs all eval cases against current prompts + procedures, reports regressions
- CI integration: PRs touching `procedures/`, `prompts/`, or model config gate on eval pass
- Historical replay is the primary signal; synthetic-conversation generation is a complement, not a substitute
- Per-procedure eval harness: edge cases, refusal cases, escalation cases all live alongside the procedure file

## Phase 7 — Procedure library + community
*Principle 6*

- Public repo `getranse/procedures-library` — refund flow, password reset, shipping dispute, subscription cancellation, fraud triage, GDPR data request, etc.
- `ranse procedure add <name>` clones from library into workspace repo as a starting point
- Each library procedure ships with eval cases and a reference MCP tool spec
- Contribution guidelines for upstreaming generic procedures back from workspaces

## Phase 8 — Insights & auto-improving KB
*Principle 5 (extends), Principle 1*

- Per-conversation rubric scoring (groundedness, tone, resolution, customer effort)
- Aggregate dashboards: resolution rate, escalation reasons, top unanswered intents, slowest procedures
- **Suggestions agent** clusters unresolved conversations weekly, drafts new KB articles **as PRs to the workspace's content repo** — human review preserved, no surprise edits
- Drift detection: flag KB entries whose answers diverge from recent successful replies

## Phase 9 — Multi-channel + voice
*Principle 7 — email is the wedge; other channels are derivatives*

- Embeddable chat widget (Pages bundle, DO per session, same `WorkspaceSupervisorAgent`)
- Web form → ticket bridge
- Voice last — Cloudflare Realtime + Whisper + TTS. Hardest channel, lowest leverage for v1, ship only when email + chat are something we'd want to talk to

## What we are explicitly not building

- **Outcome-based pricing logic.** Self-hosters own their inference bill; pricing is irrelevant. The outcome event model (Phase 3) is useful telemetry, and would back a hosted SaaS on `getranse.com` later if we go that route.
- **A proprietary "Ranse Apex" model.** Per-step model choice (Principle 2) is the feature; locking to one model is the anti-feature.
- **A private connector marketplace.** MCP is the marketplace.
- **A "CX Score" leaderboard or vanity score.** Insights are for the team operating the inbox, not a number to brag about.
- **A separate paid "operator console" tier.** The operator console is the helpdesk; there are no tiers.

## How to contribute to a phase

1. Open a GitHub Discussion in the relevant phase to propose scope
2. For Phase 1–4 work, please coordinate before starting — these are the critical path (retrieval → agentic loop → autonomy → procedures)
3. Phases 5+ are wide open — pick an MCP server, a procedure for the library, an eval harness piece
4. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the dev loop

If you're a self-hoster with a real workload, the most valuable contribution is an issue describing what your support team actually does day-to-day. That shapes priorities more than anything else.
