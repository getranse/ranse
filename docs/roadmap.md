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

That's now a retrieval-grounded early Fin **Copilot** equivalent with workspace isolation, traceable multi-hop retrieval, a conservative autonomous-send path, a procedure-driven agent loop, external action execution through the open MCP protocol, a regression gate against the workspace's own ticket history, a forkable procedure library, a sovereign insights loop that turns real support history into reviewed KB improvements, and public web surfaces that feed the same ticket model. Voice remains deliberately last.

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
