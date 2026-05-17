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

**Phase 1 — Retrieval foundations** is shipped. Workspaces get a Vectorize-backed knowledge index with Workers AI embeddings, manual sources, help-center URL crawling, PDF uploads stored in R2, resolved-ticket import, two-stage retrieve → rerank with a per-workspace reranker override, Content Library freshness/duplicate/usage signals, and Answer Inspection on drafts.

**Phase 1.5 — Workspace management & tenant isolation** is shipped. Ranse now has multi-workspace create/switch flows, role middleware, member invitations, ownership transfer, workspace mailboxes, audit/usage/export surfaces, archive/delete policy, and tenant-isolation tests around the critical workspace boundaries.

**Phase 2 — Agentic retrieval (multi-hop)** is shipped. Knowledge search now plans scoped subqueries, runs bounded multi-hop retrieval, judges sufficiency per hop, rewrites sparse searches, exposes the full trace in Answer Inspection, and provides the same search loop as a procedure primitive.

**Phase 3 — Autonomous resolution + outcome telemetry** is shipped. Mailboxes now choose a per-mailbox autonomy policy, drafts are scored from evidence quality and confidence, safe cases can auto-send, and ticket outcomes plus feedback/follow-up signals are stored for evals and insights.

That's now a retrieval-grounded early Fin **Copilot** equivalent with workspace isolation, traceable multi-hop retrieval, and a conservative autonomous-send path. Everything below continues the path from copilot to procedure-driven agent built around the seven principles above.

## Phase 1 — Retrieval foundations
**Status: shipped.**

*Principle 1 (sovereign), Principle 5 (eval-first feeds on this)*

The floor. Without real retrieval, every later phase is hand-waving.

- Vectorize index per workspace; embeddings via Workers AI
- Ingest sources: help-center URLs (crawl + chunk), PDFs in R2, **resolved tickets** (mine your own historical replies — highest-signal source, free for us because we already store them)
- Two-stage retrieve → rerank pipeline; reranker model selectable per workspace
- Content Library UI: sources, last-crawled, "used in N answers", staleness flags, dedupe warnings
- "Answer Inspection" in operator console — every draft shows which chunks grounded it, click-through to source
- **Stays in your account** — no embeddings ever leave the workspace's Cloudflare tenant

## Phase 1.5 — Workspace management & tenant isolation
**Status: shipped.**

*Principle 1 (sovereign), platform foundation for every later phase*

The codebase is workspace-scoped: tickets, messages, knowledge, settings, provider keys, notifications, agents, R2 keys, and sessions all carry a workspace boundary. Phase 1.5 adds the platform surface so operators can create, switch, administer, and isolate multiple workspaces without setup-time shortcuts.

- **Workspace lifecycle**
  - Create additional workspaces after initial setup
  - Rename, archive, and delete workspaces with confirmation and audit events
  - Transfer ownership between users
  - Harden slug generation and uniqueness beyond the first setup workspace
- **Workspace switching**
  - Add an API endpoint to change the active workspace for the current session
  - Add a workspace picker to the app shell
  - Remove "first workspace wins" login behavior; require an explicit current workspace when a user belongs to more than one
- **Team management**
  - Invite users to a workspace
  - Accept invitations and join the correct workspace with the intended role
  - Remove users from a workspace
  - Change member roles
- **Role enforcement**
  - Enforce `owner`, `admin`, `agent`, and `viewer` permissions per route
  - Restrict workspace settings, provider keys, mailbox provisioning, notification channels, destructive actions, and member management to the right roles
  - Add authorization tests for every sensitive route
- **Tenant isolation tests**
  - Prove a user in workspace A cannot read or mutate tickets, knowledge, settings, notifications, provider keys, assets, or mailboxes from workspace B
  - Prove inbound mailbox routing cannot attach a message to the wrong workspace
  - Prove Durable Object names, Vectorize namespaces, R2 keys, and audit events remain workspace-safe
- **Workspace admin UX**
  - Show the active workspace in the sidebar/header
  - Add workspace settings sections for members, invitations, mailboxes, provider keys, notification channels, and workspace metadata
  - Keep mailbox provisioning and verification scoped to the selected workspace
- **Operational platform features**
  - Add a workspace audit log viewer
  - Add workspace-level usage metrics for tickets, messages, knowledge sources, LLM calls, and notifications
  - Define export, archive, and delete policies for workspace data
  - Put stronger confirmation and audit flows around destructive actions

## Phase 2 — Agentic retrieval (multi-hop)
**Status: shipped.**

*Principle 2 (per-step model), Principle 5 (eval cases test the loop)*

Single-pass RAG fails on the hard tickets — the ones where the customer's question implies three sub-questions, or the answer requires combining a help-center article with a piece of account state. This is where Fin's lead is real and where naive OSS RAG loses. Closing it is its own phase, not a footnote on Phase 1.

- **Retrieval planner**: shipped. The `knowledge_plan` step decomposes customer questions into scoped subqueries for KB sources, resolved tickets, all local sources, or a reserved `customer_data` scope.
- **Sufficiency judge**: shipped. The `knowledge_judge` step decides whether accumulated evidence is answerable, bounded by a max-hop budget.
- **Query rewriting per hop**: shipped. Sparse/insufficient searches call `knowledge_rewrite` before the loop gives up.
- **Per-hop model routing** (Principle 2): shipped. Planning, judging, rewriting, reranking, and drafting each have independent action keys in workspace model settings.
- **`search` as a procedure primitive** (Principle 3): shipped. Phase 4 procedures can call `search(query, scope, max_hops)` with the same traceable retrieval loop.
- **Answer Inspection shows the trace**: shipped. Drafts, approval suggestions, and Content Library test searches show hop query → results → judgment → next-query.
- **Eval cases test the loop, not just the final answer** (Principle 5): partially shipped as behavior tests around the loop contract. Historical replay belongs in Phase 6.

The `customer_data` scope currently fails closed with an explicit trace until Phase 5 MCP connectors provide real external account-state search.

## Phase 3 — Autonomous resolution + per-step model routing
**Status: shipped.**

*Principle 1, Principle 2*

- Per-mailbox autonomy is shipped as `draft_only`, `auto_send_if_confident`, and `auto_send_always`, with a mailbox-level confidence threshold.
- Confidence scoring is shipped from groundedness, top retrieval scores, LLM draft self-report, and retrieved-chunk freshness.
- **Per-step model config** is shipped in workspace settings for triage, draft, retrieval planning/judging/rewrite, reranking, and future procedure steps.
- Outcome event model in D1 is shipped for `resolved_autonomously`, `resolved_via_procedure`, `escalated`, and `customer_followed_up`.
- Customer feedback hooks are shipped for operator thumbs up/down, and inbound follow-up detection records `customer_followed_up`.
- The autonomous path fails closed: spam, hostile/urgent tickets, insufficient evidence, uncited evidence, and human-review flags create approvals instead of sending. The confidence-threshold policy also gates weak scores and stale evidence.
- Scheduled autonomy is idempotent for a source inbound message: retries skip if the message already has a pending approval or threaded outbound reply.
- Autonomous send rollout is shipped as a deterministic mailbox-level percentage, so operators can canary auto-send before expanding it.
- Signed customer feedback links are shipped for outbound replies when `APP_URL` is configured; clicks record customer feedback without a logged-in session.
- Daily outcome rollups are shipped in D1 and available through the workspace admin API/export for Phase 6 evals and Phase 8 insights.

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
