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

**Phase 4 — Procedures as code** is shipped. Workspaces can publish versioned procedure specs, run them against tickets through a checkpointed `ProcedureRunnerAgent`, pause/resume across customer turns, simulate procedures locally, and keep previous versions addressable for in-flight runs.

**Phase 5 — MCP-native actions** is shipped. Workspaces can register remote Streamable HTTP MCP servers, discover tools, enforce per-tool guardrails, pause destructive calls for operator approval, and execute `call_action` from procedures with audit-backed tool-call records.

**Phase 6 — Historical evals** is shipped. Resolved tickets are captured as anonymized replay cases, operators can backfill and run evals from Settings, `ranse eval` runs procedure-file and hosted historical suites, and PRs touching prompts/procedures/model logic have an eval workflow.

**Phase 7 — Procedure library** is shipped. Workspaces can install vetted workflows from Settings, fork them locally with `ranse procedure add`, and inspect reference MCP tool contracts plus inline evals before customization.

**Phase 8 — Insights & auto-improving KB** is shipped. Workspaces get conversation rubric scoring, aggregate insight dashboards, unresolved-intent KB suggestions, accepted-suggestion publishing into the knowledge base, drift signals against successful replies, and weekly scheduled insight maintenance.

**Phase 9 — Multi-channel** is shipped end-to-end across thirteen channel kinds + three voice providers behind one `ChannelAdapter` contract: chat widget, hosted form, Slack, SMS (Twilio), Discord, Telegram, WhatsApp Business, Microsoft Teams, Facebook Messenger, Instagram DM, Google Business Messages (RCS), Apple Messages for Business, a generic outbound webhook, and voice (ElevenLabs Conversational AI, Twilio + Cloudflare Workers AI, Gemini Live). Surrounding the adapters: signed-webhook verification, replay-safe ingress dedup, capability-aware procedure branching, per-channel SLA overrides, cross-channel identity stitching, customer channel preferences (with STOP-keyword honoring + quiet hours), workspace-keyed AES-GCM encryption of every adapter secret at rest, an omnichannel notification cascade engine (`notifyCustomer({customer, template, urgency, cascade})` fans across channels with read-receipt acknowledgement), and an exponential-backoff retry queue with dead-letter for failed outbound dispatches.

**Phase 10 — Post-Fin parity** is shipped end-to-end with operator UI. Real-time draft assist (debounced ghost-text completion + Tab-to-accept + KB nearby + similar-past-tickets sidebar, wired into the reply composer), long-term customer memory (auto-extracted on ticket resolution, injected into procedure context, surfaced as an editable + redactable drawer in the ticket sidebar), operations dashboards (resolution / deflection / TTFR / TTR / CSAT / follow-up rate + volume-by-channel bars, rendered as the first card in the Insights view with a 7/30/90-day window selector), and a live procedure flow-diagram (SVG renderer with terminal/process/io/decision/loop_container shapes + yes/no edge labels + approval-gate badges, previewing the operator's procedure JSON as they edit it).

**Phase 10.1 — Theme and onboarding** is shipped. Full light/dark theme system with `system/light/dark` toggle (persisted in localStorage, applied before React mounts so there's no light-to-dark flash on first paint), a token-driven CSS pass that funnels every color/space/shadow/focus-ring through one file so contributors can re-theme without touching components, and a derived-state onboarding checklist that auto-completes as the operator adds knowledge / connects a channel / sends their first reply, dismissible workspace-wide via `workspace.settings_json`.

That's now equivalent or ahead of Fin on every customer-visible axis — and ahead structurally because the same buyer self-hosts it on their own Cloudflare account with multi-provider LLM routing, MCP-native actions, evals against their actual ticket history, and a forkable procedure library no closed SaaS can replicate.

**Phase 11 — 100 steps ahead of Fin** is in progress. Seven moves that turn structural advantages into features Fin cannot match: Honest Resolution metric (verified-by-customer, no forced closes), outcome-based pricing instrument (cost-per-verified-resolution ledger), MCP Action Library (20+ first-party templates covering refund / address edit / subscription pause / etc.), public procedure marketplace with attribution + fingerprints, customer-facing decision trace ("Why this answer?" public link), knowledge staleness as a first-class retrieval signal, and the proactive resolution loop (cluster → draft procedure + KB → eval-gated → one-click publish). The full plan is in the Phase 11 section below.

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
- **Eval cases test the loop, not just the final answer** (Principle 5): behavior tests cover the loop contract, and Phase 6 historical replay now runs resolved-ticket cases end-to-end.

The `customer_data` search scope still fails closed with an explicit trace; procedures can now retrieve account state by calling registered MCP tools directly through `call_action`.

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
**Status: shipped.**

*Principle 3 — the biggest single differentiator*

- Procedures are defined as YAML, JSON, or TS files and published as immutable versions.
- Schema includes trigger, steps, version, owner, and eval case metadata.
- `ProcedureRunnerAgent` runs each procedure as a Durable Object, with D1 checkpoints, deterministic replay of branch/loop decisions, resumable waits, and scheduled timeout handling.
- Step primitives are shipped for `ask_customer`, `search` (Phase 2 loop), `add_note`, `escalate_to`, `set_ticket_field`, `call_action`, `wait_for_event`, `if/else`, and `loop`.
- Manual, ticket-created, and triage-category triggers are shipped; trigger event keys dedupe replayed events.
- `call_action` executes MCP tools through the Phase 5 registry, guardrails, approval gate, and audit trail.
- GitOps-style publishing is available through `ranse publish <procedure>` using the Git source ref; previous versions stay addressable for in-flight runs.
- `ranse simulate <procedure>` performs local dry-runs before opening a PR.

## Phase 5 — MCP-native actions
**Status: shipped.**

*Principle 4*

- Actions are exclusively MCP tool calls — no bespoke connector framework.
- Workspace registers remote Streamable HTTP MCP servers via URL + auth in settings; tool lists are auto-discovered with `tools/list`.
- The procedure runner calls `tools/call`, stores every attempt in `mcp_tool_call`, passes an idempotency key in MCP `_meta`, and records audit events for requested, completed, failed, blocked, and rejected calls.
- MCP calls are bounded by HTTP timeout and response-size limits, with protocol-version checks during `initialize`.
- Per-tool guardrails are enforced in Ranse before the MCP server is called: requires-approval, rate limits per ticket/hour, dollar limits, allowed customer segments, and disabled tools.
- Read vs. write distinction is surfaced from MCP tool annotations; read-only tools can run automatically, while unknown/destructive tools default to operator approval.
- First-party templates are in-repo for Stripe, Shopify, GitHub, Linear, and generic webhook MCP servers so workspaces can register their own protocol-native endpoints without adding connector code to Ranse.

## Phase 6 — Eval against your own ticket history
**Status: shipped.**

*Principle 5*

- Resolved or closed conversations are captured into `eval_case` with transcript, latest customer message, expected reply preview, outcome kinds, and deterministic source fingerprints.
- Capture runs automatically when an operator marks a ticket `resolved` or `closed`, when autonomous resolution succeeds, and when a procedure resolves a ticket. Backfill uses both ticket status and resolved outcome events.
- PII anonymization is applied before persistence, with configurable email, phone, and requester-name redaction rules. Residual PII detection fails closed instead of storing a case when redaction leaves sensitive data behind.
- Hosted eval runs replay active historical cases through current retrieval + draft logic, score overlap and required terms, compare against the previous baseline result, and store per-case assertions in `eval_result`.
- Regression gates distinguish first-run failures from true regressions: a previous pass that now fails, or a score drop beyond the configured threshold, increments `regression_count`.
- Operators can archive noisy historical cases from **Settings → Evals** without deleting the audit trail.
- `ranse eval <procedure-file>` runs inline procedure evals from the YAML/JSON/TS spec. Edge, refusal, escalation, and wait/resume expectations live next to the procedure.
- `.github/workflows/evals.yml` gates PRs touching procedure, prompt/model, supervisor, or eval code on local procedure evals; with `RANSE_APP_URL` and `RANSE_COOKIE` secrets, the same workflow also gates on hosted historical replay.
- Historical replay is the primary signal; synthetic-conversation generation remains a future complement, not a substitute.

## Phase 7 — Procedure library + community
**Status: shipped.**

*Principle 6*

- Built-in catalog ships refund intake, password reset, shipping dispute, and GDPR data request workflows.
- Settings exposes the catalog so owners/admins can install procedures directly into the selected workspace, with MCP readiness surfaced before install.
- `ranse procedure list` and `ranse procedure add <slug>` fork procedures into a repo-local `procedures/` directory as YAML or JSON.
- `ranse procedure manifest` exports the full machine-readable catalog for a standalone community mirror.
- Each library procedure ships with inline eval cases, deterministic SHA-256 provenance, and reference MCP tool specs written beside the forked procedure as `<slug>.mcp.json` plus `<slug>.provenance.json`.
- Library procedures now exercise required MCP contracts through `call_action`; read-only lookups can run automatically, while write/destructive actions pause for operator approval.
- Library validation runs every procedure's inline evals, checksum generation, immutable clone behavior, route permissions, MCP reference matching, and unsafe-action checks in `tests/procedure-library.test.ts`.
- `procedure-library/README.md` and `CONTRIBUTING.md` define the contribution bar for upstreaming generic workflows. A standalone `getranse/procedures-library` repo can now mirror this catalog when community volume warrants it.

## Phase 8 — Insights & auto-improving KB
**Status: shipped.**

*Principle 5 (extends), Principle 1*

- Per-conversation rubric scoring is stored in D1 for groundedness, tone, resolution, customer effort, and overall quality, with signals preserved as auditable JSON.
- Aggregate dashboards are shipped in the operator console for resolution rate, follow-ups, feedback, low-score conversations, top unresolved intents, escalation reasons, and slowest procedures.
- The suggestions loop clusters repeated unresolved conversations, stores evidence count/confidence/source-ticket lineage, drafts reviewable KB article candidates, and lets an admin accept a suggestion into the workspace knowledge base. Human review is preserved; no content is published silently.
- Drift detection flags cited knowledge sources that no longer cover terms appearing in successful replies tied back to those source chunks.
- Weekly scheduled insight maintenance scores recent conversations, refreshes unresolved-intent suggestions, detects KB drift, prunes old recomputable score rows, and isolates per-workspace failures inside the customer's Cloudflare account.

## Phase 9 — Multi-channel + voice
**Status: every channel shipped, voice included.**

*Principle 7 — email is the wedge; other channels are derivatives*

Channels are now plug-and-play behind a single `ChannelAdapter` contract (`src/channels/adapters/`). Adding a new built-in channel is one adapter file (signature verify, ingress parse, egress send, capability map, optional `onActivate` to register the webhook with the provider) plus one line in `adapters/index.ts`. Adapter config lives in `public_channel.config_json` so new channels do not require schema migrations.

**Shipped surfaces:**

- **Embedded chat widget** at `/widget/<public_key>.js` and **hosted form** at `/forms/<public_key>` — first-party surfaces that talk to `/public/*` directly.
- **Slack** Events API (signed-webhook ingress, `chat.postMessage` egress, thread_ts threading).
- **SMS** via Twilio Messages API (HMAC-SHA1 signature verification, `Messages.json` egress; provider field future-proofs Vonage/Plivo).
- **Discord** Interactions endpoint (Ed25519 signature verification, bot REST egress).
- **Telegram** Bot API (secret-token webhook header, `setWebhook` on activation, `sendMessage` egress).
- **WhatsApp Business Cloud API** (X-Hub-Signature-256 verification, multi-WABA filtering by phone_number_id, Graph `/messages` egress).
- **Microsoft Teams** (Bot Framework activity webhooks + Azure client-credentials bearer token for outbound).
- **Facebook Messenger** (Meta Graph webhook, per-Page access token, `/me/messages` egress with `messaging_type: RESPONSE`).
- **Instagram DM** (Meta Graph webhook with `object='instagram'`, IG-business-account-scoped outbound).
- **Google Business Messages (RCS)** (HMAC-signed partner webhook + OAuth bearer outbound).
- **Apple Messages for Business** (`x-apple-webhook-secret` or HMAC-of-body inbound, JWT bearer outbound through the MSP gateway).
- **Generic outbound webhook** — the meta-channel. Signed HMAC in both directions, lets operators plug any system into Ranse without writing an adapter.
- **Voice** — single `voice` channel kind, three dynamic providers selected per workspace via `config.provider`:
  - **ElevenLabs Conversational AI** — signed post-call webhook ingests full transcript, recording (mp3 → R2), summary, and per-turn rows; tool calls flow back into the MCP/procedure surface.
  - **Twilio Voice + Cloudflare Workers AI** — TwiML `<Connect><Stream>` answers the call, the Worker bridges μ-law audio through Whisper (STT) + Llama (reply) + MeloTTS (speech), turn-by-turn persistence happens inside the WebSocket relay.
  - **Gemini Live API** — browser/Twilio WebSocket relayed straight into Google's `BidiGenerateContent` channel; bidirectional audio + inline transcripts.
  Calls land in a normal `ticket` with `origin_channel_kind='voice'`. Every call gets a `voice_call` row and every utterance a `voice_call_turn` plus a `message_index` entry, so the reply pipeline, procedures, identity stitching, and operator UI see voice transparently.

**Cross-cutting infrastructure:**

- Single `/public/channels/<key>/webhook` endpoint dispatches to the right adapter; the route does not care which provider.
- `channel_outbound_dispatch` records every egress attempt with status, attempts, last_error, and provider message id for audit and retry.
- `customer` + `channel_identity` stitch (workspace, channel, external_id) records to one customer id; operators see one history per person across surfaces. Stitching is conservative — same email/phone merges, ambiguity creates separate records.
- Per-channel SLA + default priority + default assignee override the workspace baseline for tickets that originate on that channel.
- Procedures get `channel.capabilities` in context (`supportsOtpDelivery`, `supportsButtons`, `supportsRichText`, `maxMessageLength`, `supportsVoice`, `supportsStreaming`) so the same workflow takes the strongest identity-proof path the originating channel supports. `verify-identity-channel-aware` ships in the library as the reference branch; the voice path adds capability-aware reply-length trimming (the LLM is told to stay under ~30 words because the reply will be spoken).
- **Customer channel preferences.** `customer_channel_preference` rows gate every outbound — opt-out is hard-blocking, and quiet-hours windows roll cascade plans forward instead of breaching. STOP/UNSUBSCRIBE keywords on inbound text auto-disable the channel for that customer. Operators see + edit preferences in the customer drawer.
- **Workspace-keyed encryption at rest.** Adapters declare `secretFields` (bot tokens, API keys, auth tokens). Channel admin partitions the validated config into `config_json` (public, visible in dashboards) and `secrets_ciphertext` (AES-GCM-256 with HKDF-derived per-workspace key). Existing channels keep working — the read path tolerates legacy plaintext until the next save.
- **Notification cascade engine.** `notifyCustomer({customer, template, urgency, cascade})` materializes a `notification_plan` plus `notification_step` rows. The scheduled tick advances plans, an inbound customer reply on any channel ack's all pending plans for that customer, and templates render with `{{ payload.field }}` substitution. Cascade trigger reasons: `immediate`, `previous_failed`, `previous_unread`, `previous_no_ack`, `time_elapsed`.
- **Retry queue + DLQ.** Failed outbound dispatches schedule `next_attempt_at` with 60s/5m/30m/2h/8h exponential backoff (±10% jitter); the periodic `dispatch-retry-sweep` re-fires them through the adapter, settling into status `failed` after `max_attempts`. Preference-blocked sends never retry.

## Phase 10 — Post-Fin parity
**Status: shipped.**

*Principle 2 (per-step model), Principle 3 (procedures as code, now rendered)*

The four highest-leverage gaps Fin had over Ranse before this phase. All four shipped.

- **Real-time draft assist** (`/api/tickets/:id/draft-assist`). Operator types in the reply composer; the endpoint returns a one-sentence completion (ghost text) plus 4 KB hits and 3 similar past resolved tickets. Uses the fast `summarize` action — never blocks on the agentic retrieval loop — so p95 stays low enough for keystroke cadence. KB grounding is the same vector pipeline drafts use, so suggestions are workspace-private.
- **Long-term customer memory.** `customer_memory` table holds distilled durable facts about a customer (account type, preferences, prior complaints, communication style) extracted by an LLM after each resolved ticket. Memory injects into every procedure run as `customer.memory[]`, the draft generator reads it, and operators can list/edit/redact via `/api/memory/customers/:id`. The extractor is conservative — facts below 0.4 confidence are dropped, sensitive PII is explicitly prohibited, and operator-authored entries can never be overwritten by inference.
- **Operations dashboards.** `/api/insights/operations` returns resolution rate, autonomous-resolution rate, procedure-resolution rate, deflection rate, time-to-first-response p50/p90, time-to-resolution p50/p90, CSAT score, follow-up rate, and ticket volume broken out by `origin_channel_kind`. All computed from existing tables — no new ingest pipeline.
- **Procedure flow diagram.** `layoutProcedure(spec)` is a pure data transform from `ProcedureSpec` to `{ nodes, edges, width, height }`. The `ProcedureFlowDiagram` React component (`src/ui/components/ProcedureFlowDiagram.tsx`) renders it as SVG with decision diamonds for `if`, IO parallelograms for `ask_customer` / `wait_for_event`, rectangles for `call_action` / `add_note` / `set_ticket_field`, double-stroke loop containers, approval-gate badges on write actions, and yes/no labels on `if` edges. Live-previewed in the Procedures settings tab as the operator edits the JSON spec. Procedures stay code-first (Principle 3); the diagram is the read-only view non-engineers can review.

### UI components shipped

| Component | Location | Wired into |
|---|---|---|
| `DraftAssistPanel` | `src/ui/components/DraftAssistPanel.tsx` | `Ticket.tsx` reply composer |
| `OperationsDashboard` | `src/ui/components/OperationsDashboard.tsx` | `Insights.tsx` (top of view) |
| `CustomerMemoryDrawer` | `src/ui/components/CustomerMemoryDrawer.tsx` | `TicketSidebar.tsx` when `ticket.customer_id` is set |
| `ProcedureFlowDiagram` | `src/ui/components/ProcedureFlowDiagram.tsx` | `ProceduresSection.tsx` live spec preview |

## Phase 10.1 — Theme and onboarding
**Status: shipped.**

*Operator experience polish on top of the real app, without fake data paths.*

- **Theme system.** `system`, `light`, and `dark` modes are persisted in `localStorage` and applied before React mounts so the app does not flash the wrong theme on first paint.
- **Token-driven styling.** Color, space, shadow, and focus-ring choices now flow through the shared CSS token layer, so contributors can re-theme the app without rewriting component styles.
- **Onboarding checklist.** The operator onboarding banner derives state from real workspace data: knowledge sources, connected mailboxes/channels, and outbound replies.
- **Workspace-wide dismissal.** Operators can dismiss onboarding once per workspace through `workspace.settings_json`; completed workspaces hide the banner automatically.

## Phase 11 — 100 steps ahead of Fin

> **Status: in progress.** Phase 11 is the first phase where Ranse stops chasing Fin's surface area and starts shipping the features Fin *structurally cannot*. The capability map after Phase 10 already covered every customer-visible axis Fin has. Phase 11 is the wedge.

### The seven moves

Each move is grounded in a documented Fin / category pain point and maps to existing Ranse infrastructure. None is greenfield — every one extends a shipped subsystem.

| # | Move | Pain solved | Foundation |
|---|------|------------|------------|
| 1 | Honest Resolution metric | Forced-close counting, 38% vs 50% reality gap | `src/lib/outcomes.ts`, `src/insights/operations.ts` |
| 2 | Outcome-based pricing instrument | $0.99/resolution unpredictability, perverse incentives | `ticket_outcome_event`, `workspace_outcome_daily` |
| 3 | MCP Action Library (20+) | Fin explains but cannot fix (refunds, addresses, subs) | `src/mcp/first-party/catalog.ts` |
| 4 | Public procedure marketplace | Vendor lock-in, slow content velocity | `src/procedures/library*` |
| 5 | Customer-facing decision trace | 74% rollback rate driven by trust failure | `src/lib/audit.ts`, Answer Inspection |
| 6 | Knowledge staleness signal | Stale KB silently kills resolution rate | `src/insights/` drift, `knowledge_source` |
| 7 | Proactive resolution loop | Reactive ceiling; no competitor closes this loop | `src/insights/`, procedures, evals |

### Move 1 — Honest Resolution metric

#### Problem
Industry-standard "resolution rate" is gamed. Fin counts a resolution if it answers and the customer doesn't reply within 24h, *even when a human took over*. Builts AI tested 500 tickets across four small businesses and measured a real 38% resolution rate against a marketed 50%. The market knows the number is fake but every competitor reports it the same way.

#### Definition (new)
A ticket counts as a `verified_resolution` only if **all** of the following hold:

1. **AI authored**: at least one outbound message on the ticket was AI-generated (autonomous or procedure) with no human edit > 20 characters.
2. **No human takeover**: `audit_event` shows no `reply.sent` row where `actor_type='user'` after the AI message.
3. **No escalation**: no `escalated` outcome event.
4. **No customer follow-up within 7 days** of the AI message: no inbound message + no `customer_followed_up` outcome.
5. **Customer-confirmed OR aged out**: either a positive `ticket_feedback` row, or the 7-day window closed with no negative signal.

#### Data model
```
verified_resolution
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL
  ticket_id TEXT NOT NULL UNIQUE
  ai_message_id TEXT NOT NULL
  ai_authored_at INTEGER NOT NULL
  window_closes_at INTEGER NOT NULL   -- ai_authored_at + 7d
  status TEXT NOT NULL                -- 'pending' | 'verified' | 'rejected'
  rejection_reason TEXT               -- 'human_takeover' | 'escalated' | 'follow_up' | 'negative_feedback'
  verified_at INTEGER
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL
```

#### Service
`src/insights/honest-resolution.ts`
- `enqueueVerification(env, ticket, aiMessage)` — called when an autonomous or procedure reply lands. Inserts a `pending` row with `window_closes_at = now + 7d`.
- `rejectVerification(env, ticketId, reason)` — called on human reply / escalation / negative feedback / follow-up signal. Idempotent.
- `sweepDueVerifications(env, workspaceId)` — promotes pending rows whose window closed and have no rejection.
- `computeHonestResolutionRate(env, workspaceId, windowDays)` — returns `{ aiAuthored, verified, rejected, pending, rate, finStyleRate }`.

#### API
`GET /api/insights/honest-resolution?days=30` → ratio + breakdown. Already wired through `requireWorkspaceRole(OWNER_OR_ADMIN)`.

#### UI
`OperationsDashboard` gets a second resolution card showing both rates side by side, with a small explainer popover. Marketing surface: same component renders on a public benchmarks page for opted-in workspaces.

#### Cron
Sweep on the existing 5-minute scheduled tick (`src/jobs/scheduled.ts`). Already runs SLA + cascade + dispatch sweeps; verification sweep is one more call.

#### Tests
- AI auto-send + no reply for 8 days → verified
- AI auto-send + human reply within window → rejected `human_takeover`
- AI procedure reply + negative customer feedback → rejected `negative_feedback`
- AI auto-send + follow-up event within window → rejected `follow_up`
- Pending row promoted by sweep when window closes

---

### Move 2 — Outcome-based pricing instrument

#### Problem
Fin's $0.99/resolution is the #1 G2 complaint. Pricing is unpredictable, scales linearly with success, and the "resolution" definition rewards ambiguous closes. Ranse is sovereign — customers pay their own inference bill — so we don't *need* to charge per resolution. But we can ship the instrument that lets buyers think in outcome dollars, and provide a hosted SaaS path later.

#### Concept
An **outcome ledger** that values each `ticket_outcome_event` against a workspace-configurable price book and reports a `cost_per_outcome` and a `value_delivered` figure. Read-only telemetry by default; if/when Ranse runs a hosted SaaS, the same ledger can drive invoicing.

#### Data model
```
workspace_outcome_pricing
  workspace_id TEXT PRIMARY KEY
  config_json TEXT NOT NULL            -- prices keyed by outcome kind + verified flag
  inference_cost_cents_per_1k INTEGER  -- optional self-reported model cost
  currency TEXT NOT NULL DEFAULT 'USD'
  updated_at INTEGER NOT NULL

outcome_ledger_entry
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL
  ticket_id TEXT NOT NULL
  outcome_event_id TEXT
  kind TEXT NOT NULL                   -- 'verified_resolution' | 'autonomous_resolution' | 'escalation' | 'follow_up_cost' | 'inference_cost'
  amount_cents INTEGER NOT NULL        -- signed: positive = value, negative = cost
  metadata_json TEXT
  created_at INTEGER NOT NULL
```

#### Price book defaults
| Outcome | Default cents | Rationale |
|---|---|---|
| verified_resolution | +1500 | Industry comparator for an AI resolution worth |
| autonomous_resolution (not yet verified) | +500 | Provisional; reconciles to verified at window close |
| follow_up_cost | -300 | Customer came back; cost of incomplete resolution |
| escalation | -200 | Routed to human; partial credit lost |
| inference_cost | computed | From recorded LLM call token counts |

All editable per workspace. Stored as a single JSON blob to avoid migrations when we add an outcome kind.

#### Service
`src/billing/outcomes.ts`
- `recordLedgerEntry(env, …)` — called from outcome hooks
- `loadPricing(env, workspaceId)` — with defaults fallback
- `computeOutcomeStatement(env, workspaceId, windowDays)` — returns `{ entries, totals, cost_per_verified_resolution, roi_ratio, breakdown }`
- `replayBackfill(env, workspaceId, since)` — rebuilds the ledger from existing outcome events for first-time pricing setup.

#### API
- `GET /api/billing/pricing` / `PUT /api/billing/pricing`
- `GET /api/billing/statement?days=30`
- `POST /api/billing/statement/backfill` (owner only)

#### UI
`Settings → Pricing` with editable price book + live preview of last 30 days' statement. Operations dashboard adds a "Cost per verified resolution" card under the resolution mix.

#### Tests
- Ledger entries created on outcome events
- Statement computes correct totals across mixed outcome kinds
- Backfill is idempotent
- Negative entries are signed correctly

---

### Move 3 — MCP Action Library

#### Problem
75–80% of action-requiring tickets still escalate. Fin "explains, doesn't fix" — it can describe an order but cannot edit a shipping address, process a refund, or pause a subscription. This is a category-level gap. Ranse already supports MCP-native actions but ships only 5 first-party templates.

#### Scope
Expand `src/mcp/first-party/catalog.ts` from 5 to 20 templates covering the highest-leverage support actions across ecom, SaaS, identity, and ops. Each template includes:

1. Entry in `FIRST_PARTY_MCP_TEMPLATES`
2. Tool-contract JSON (`src/procedures/library-mcp-tools.ts` extension)
3. A reference procedure under `src/procedures/library-data.ts` consuming the tools
4. Inline evals + provenance via the existing pipeline
5. Documentation in `procedure-library/README.md`

#### Catalog

| ID | Label | Tools (read / write) | Reference procedure |
|---|---|---|---|
| stripe | Stripe | customers.search, charges.retrieve / refunds.create | refund-intake (existing) |
| shopify | Shopify | orders.search, orders.retrieve / orders.update_address, refunds.create | order-address-edit, ecom-refund |
| recharge | Recharge | subscriptions.retrieve / subscriptions.pause, subscriptions.cancel | subscription-pause |
| salesforce | Salesforce | cases.search, contacts.retrieve / cases.create | enterprise-escalation |
| hubspot | HubSpot | contacts.search, deals.retrieve / contacts.update | crm-context-sync |
| linear | Linear | issues.search / issues.create, issues.update | (existing) bug-escalation |
| github | GitHub | issues.list / issues.create | (existing) feature-request-intake |
| pagerduty | PagerDuty | incidents.list / incidents.create, incidents.acknowledge | outage-report |
| jira | Jira | issues.search / issues.create | jira-bug-escalation |
| zendesk | Zendesk import | tickets.list (read-only migration) | zendesk-migration-import |
| klaviyo | Klaviyo | profiles.search / profiles.suppress | unsubscribe-confirmation |
| twilio-verify | Twilio Verify | verifications.create | verify-identity-channel-aware (existing) |
| auth0 | Auth0 | users.search / tickets.password-change | password-reset (existing, retarget) |
| notion | Notion | pages.search, databases.query / pages.create | docs-handoff |
| datadog | Datadog | events.list / events.create | incident-cross-post |
| snowflake | Snowflake | query.execute (read-only) | usage-lookup |
| mixpanel | Mixpanel | events.query (read-only) | engagement-context |
| slack | Slack | conversations.history / chat.postMessage | shared-channel-escalation |
| calendly | Calendly | event-types.list, scheduled-events.list | meeting-context |
| webhook | Generic webhook | webhook.call (existing) | (any) |

#### Read vs write annotation
Each tool carries `annotations.readOnlyHint` / `destructiveHint` so the procedure runner can auto-execute reads and pause writes for operator approval (Phase 5 contract preserved).

#### Validation tests
`tests/mcp-catalog.test.ts`:
- Every catalog entry has a matching reference procedure
- Every reference procedure validates against `procedure.v1` schema
- Every destructive tool has `requires_approval: true` in its reference call
- All tool contracts parse cleanly

#### Out of scope
We are not shipping MCP server implementations — those are the customer's eng team's job. We ship the contracts so when their MCP server exposes a tool by that exact name, our reference procedure works untouched.

---

### Move 4 — Public procedure marketplace

#### Problem
Vendor lock-in is the #2 reason teams switch off Fin. Their procedure library is opaque and trapped in their UI. Ranse already ships procedure-library forking via `ranse procedure add` but the discovery surface is in-app only.

#### Concept
A **public registry** (initially at `procedures.ranse.dev`, mirrored as JSON in-repo) where:
- Anyone can browse / search procedures with eval pass rates
- `ranse procedure add <slug>` resolves against the public manifest first, then falls back to in-tree library
- Forks carry a parent SHA-256 fingerprint so updates can be diffed
- Procedure authors get attribution

#### Data model
```
procedure_marketplace_install
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL
  slug TEXT NOT NULL
  source_manifest_url TEXT
  parent_fingerprint TEXT NOT NULL
  installed_at INTEGER NOT NULL
  installed_by TEXT
  forked_version TEXT NOT NULL
```

Plus an export script (`scripts/marketplace-export.ts`) that turns the in-tree library into a marketplace-ready manifest with stable URLs, contributor metadata, eval pass rates from the last CI run, and SHA-256 fingerprints.

#### Service
`src/procedures/marketplace.ts`
- `installFromManifest(env, workspaceId, slug, manifestUrl?)` — fetches manifest, validates schema, validates inline evals, persists install record
- `listMarketplaceInstalls(env, workspaceId)`
- `checkForUpdates(env, workspaceId)` — compares each install's `forked_version` against the current manifest entry

#### API
- `GET /api/procedures/marketplace/installs`
- `POST /api/procedures/marketplace/install` `{ slug, manifest_url? }`
- `GET /api/procedures/marketplace/manifest` (returns the workspace's own published manifest for mirroring)

#### CLI
`ranse procedure publish <file>` — produces a marketplace-shaped JSON with checksums + author + commit SHA. Output committed to a `marketplace/` directory in the workspace's procedures repo.

#### Tests
- Install round-trips fingerprint
- Manifest validation rejects unknown schema versions
- Update detection flags stale forks

---

### Move 5 — Customer-facing decision trace

#### Problem
The Register reported that **74% of AI customer-service rollouts get rolled back**. The Notch and CNBC pieces show CSAT often drops while resolution rates rise. This is a trust failure. Operators cannot defend the AI to skeptical customers, executives, or auditors. Compliance-grade traceability is a $50K/seat enterprise feature; we already built the plumbing internally and the move is to expose it externally.

#### Concept
Every AI-authored outbound reply optionally embeds a **"Why this answer?"** link signed with HMAC. Clicking it loads `/public/trace/:token` and renders a sanitized decision trace:

- Plain-English reason for the recommendation
- KB sources cited (titles + click-through if public)
- Procedure name + step that produced this reply (no internal step IDs)
- MCP tools called (label + read/write only — no payloads)
- Confidence and grounding score
- Approval reviewer if a human signed off
- Eval pass rate of the procedure version
- Last-knowledge-refresh timestamp on cited sources

#### Security
- HMAC-signed token bound to `(workspace_id, ticket_id, message_id, exp)`
- Default 30-day expiry, configurable per workspace
- Rate-limited per IP via existing KV
- Customer PII redacted; only the customer's own messages on the same ticket are surfaced

#### Data model
No new table needed — the trace is computed at render time from existing rows: `procedure_run_step`, `mcp_tool_call`, `audit_event`, `message_index`, `knowledge_source`. New: `workspace_setting` keys for `decision_trace_enabled`, `decision_trace_branding`.

#### Service
`src/lib/decision-trace.ts`
- `signTraceToken(env, …)` — uses existing HMAC infrastructure from `feedback-links.ts`
- `verifyTraceToken(env, token)`
- `buildPublicTrace(env, workspaceId, ticketId, messageId)` — assembles the sanitized payload

#### API
- `GET /public/trace/:token` (no auth) — renders HTML page
- `GET /api/tickets/:id/messages/:messageId/trace-url` (operator) — generates a shareable link

#### UI
- `DecisionTracePublic.tsx` — standalone React route for the public page, dark/light, branded
- Outbound mailer template appends "Why this answer?" link when `decision_trace_enabled`

#### Tests
- Token round-trip
- Tampered token rejected
- Expired token rejected
- Trace omits internal IDs and other tickets' data
- Rate-limit enforced

---

### Move 6 — Knowledge staleness signal

#### Problem
Builts AI's 500-ticket test pinpointed stale KB as the silent killer: "Fin gave a technically correct answer to the wrong question, or pulled from an article that was accurate six months ago." Our `src/insights/` already detects drift; the move is to make staleness a **first-class retrieval signal** that down-ranks stale chunks and a **Knowledge Health Score** on the dashboard.

#### Definition
A chunk's `staleness_score` ∈ [0, 1] is computed from:
- Age since `last_crawled_at` (slow exponential decay)
- Drift signal: cited but appears in low-CSAT replies
- Conflict signal: contradicts higher-confidence chunks on the same topic (cosine similarity > 0.85 + tone mismatch)
- Operator override: explicit `mark_stale` action

#### Data model
Extend existing `knowledge_source`:
```
ALTER TABLE knowledge_source ADD COLUMN staleness_score REAL NOT NULL DEFAULT 0;
ALTER TABLE knowledge_source ADD COLUMN staleness_components_json TEXT;
ALTER TABLE knowledge_source ADD COLUMN staleness_updated_at INTEGER;
```

New table for per-chunk overrides where needed (rare):
```
knowledge_chunk_override
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL
  source_id TEXT NOT NULL
  chunk_id TEXT NOT NULL
  staleness_score REAL NOT NULL
  reason TEXT
  created_by TEXT
  created_at INTEGER NOT NULL
```

#### Retrieval integration
`src/knowledge/search.ts` rerank step multiplies the retrieval score by `(1 - source.staleness_score * 0.5)`. A staleness of 1.0 halves the score — never zeros it (still surface for operator review).

#### Health score
`workspace_knowledge_health` view:
- Average staleness across sources
- # sources stale (score > 0.6)
- # sources cited in last 30d that are stale
- "Health grade" A–F mapping from average

#### Cron
Weekly maintenance job already exists in `src/jobs/scheduled.ts` — append `recomputeStalenessScores`.

#### UI
- Content Library shows a staleness chip per source with mouse-over component breakdown
- Operations dashboard gains a Knowledge Health card with grade + top 3 stale sources cited recently
- `Refresh source` button in Content Library triggers re-crawl

#### Tests
- Age decay produces expected score curve
- Cited-in-low-CSAT bumps score
- Operator override pins score regardless of components
- Retrieval rerank actually down-ranks stale sources
- Health grade thresholds

---

### Move 7 — Proactive resolution loop (the capstone)

#### Problem
Every competitor is reactive. Insights detect unresolved-intent clusters but humans manually decide what to do. The move is to close the loop: detected cluster → auto-draft procedure + KB entry → run eval against historical cases → operator one-click approve → publish.

#### Flow
```
weekly cron (existing)
  ↓
src/insights/proactive.ts
  detectClusters()        # already exists via generateKbSuggestions
  ↓
  for each cluster:
    proposeRemediation()  # LLM-generated procedure draft + KB entry
    runProposalEvals()    # replay against historical eval_case set
    if eval pass rate ≥ workspace threshold (default 0.8):
      enqueueProposal(workspace, proposal)
    else:
      logRejection(reason: 'eval_regression')
  ↓
operator reviews queue
  one-click accept → publish procedure (Phase 4 pipeline) + KB entry (Phase 8 accept flow)
  one-click reject → record reason
```

#### Data model
```
proactive_proposal
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL
  cluster_id TEXT NOT NULL                    -- ties to insight cluster
  kind TEXT NOT NULL                          -- 'procedure' | 'knowledge' | 'combined'
  draft_procedure_spec_json TEXT
  draft_knowledge_entry_json TEXT
  eval_pass_rate REAL
  eval_run_id TEXT
  status TEXT NOT NULL                        -- 'pending' | 'accepted' | 'rejected' | 'auto_rejected'
  rejected_reason TEXT
  proposed_at INTEGER NOT NULL
  reviewed_at INTEGER
  reviewed_by TEXT
  applied_procedure_version TEXT
  applied_knowledge_source_id TEXT
```

#### Service
`src/insights/proactive.ts`
- `discoverProposals(env, workspaceId)` — runs after cluster detection
- `evaluateProposal(env, workspaceId, proposalId)`
- `listProposals(env, workspaceId, status?)`
- `acceptProposal(env, workspaceId, proposalId, userId)` — publishes procedure, accepts KB, marks applied
- `rejectProposal(env, workspaceId, proposalId, userId, reason)`

#### Eval gate
A proposal can only be queued for human review if its draft procedure passes ≥ 80% of an automatically-selected sample of historical eval cases that match the cluster's intent. This is the core anti-regression promise: no proactive change can ship without empirical evidence against the workspace's own history.

#### API
- `GET /api/insights/proposals?status=pending`
- `POST /api/insights/proposals/:id/accept`
- `POST /api/insights/proposals/:id/reject`
- `POST /api/insights/proposals/run` (admin, manual trigger)

#### UI
`Insights → Proposals` queue. Each card:
- Cluster summary (top tickets, count, % unresolved)
- Draft procedure: flow diagram (Phase 10 component) + raw spec
- Draft KB entry: rendered markdown
- Eval pass rate + sample case results
- Accept / Reject buttons with reason

#### Cron
Append to the weekly maintenance job after KB suggestion generation. Optional manual trigger for testing.

#### Tests
- Proposal generated for known unresolved cluster
- Eval gate rejects below-threshold proposal
- Accept publishes a real procedure version + KB source
- Reject records reason
- Auto-rejection on eval regression doesn't auto-publish

---

### Sequencing

The seven moves are independent enough to land in any order. The recommended sequence balances dependencies and visibility:

| Order | Move | Reason |
|---|---|---|
| 1 | Honest Resolution (M1) | Pure data + dashboard; no new external surfaces; immediate marketing asset |
| 2 | Knowledge staleness (M6) | Pure data + retrieval signal; supports M7 |
| 3 | Outcome pricing (M2) | Pure data + UI; no new external surfaces |
| 4 | Decision trace (M5) | Public surface; requires HMAC; trust-building externalization of work already done |
| 5 | MCP Action Library (M3) | Content + reference procedures; bulk-author |
| 6 | Procedure marketplace (M4) | Public surface; builds on M3 content |
| 7 | Proactive loop (M7) | Capstone; uses M1, M5, M6, and the eval harness |

### Success metrics

Each move ships with a success criterion. Phase 11 is shippable when all seven are met.

| Move | Metric | Threshold |
|---|---|---|
| M1 | Verified resolution rate computed for any workspace with ≥ 1 AI-authored reply | 100% coverage |
| M2 | Outcome ledger entries persisted within 1s of outcome event | p99 latency |
| M3 | Templates count + reference procedures + eval pass | ≥ 20 templates, 100% eval pass |
| M4 | A procedure can be installed end-to-end from a published manifest | green path |
| M5 | Decision trace renders for any AI-authored reply within 500ms | p95 |
| M6 | Stale source down-ranked in retrieval; health grade exposed | both wired |
| M7 | Proactive proposal generated, eval-gated, accepted, and applied | full loop closed |

### Out of Phase 11 (deferred)

- **Hosted SaaS billing.** M2 is the instrument, not the storefront. The hosted offering is its own decision.
- **MCP server implementations.** We ship contracts and reference procedures; servers stay the customer's responsibility (Principle 4).
- **Decision trace as a translatable / localized surface.** English-only at launch; localization is a separate phase.
- **Marketplace ratings / reviews.** Initial version is attribution + checksums; community-driven curation is a later move.
## What we are explicitly not building

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
