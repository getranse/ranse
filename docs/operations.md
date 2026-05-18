# Operations

## Ticket lifecycle

| Status | Meaning |
|---|---|
| `open` | New or awaiting first agent action |
| `pending` | Waiting on customer |
| `resolved` | Agent believes the issue is handled; customer can still reopen by replying |
| `closed` | Archived — no further activity expected |
| `spam` | Marked by triage or human |

Any inbound reply to a `resolved` or `closed` ticket reopens it automatically (by thread-token match).

## Approvals

Every outbound reply from the AI is gated. The flow:

1. `DraftAgent` produces `{ subject, body_markdown, cites_knowledge_ids, confidence, needs_human_review_reasons }`.
2. The supervisor creates an `approval_request` row with risk reasons based on confidence, sentiment, priority, and explicit review flags.
3. Operators see pending approvals in **Approvals** sidebar and inline on each ticket.
4. Approve (optionally with edits) → `env.EMAIL.send` → `message_index` row → audit event.
5. Reject → request stays in audit trail, no email sent.

MCP actions use the same queue. A procedure `call_action` that is not explicitly safe creates a `call_external` approval with the server, tool, arguments, and guardrail reasons. Approving resumes the waiting `ProcedureRunnerAgent`; rejecting marks the tool call blocked and the procedure failed.

## MCP actions

Register MCP servers in **Settings → MCP actions**. Endpoints must be HTTPS and publicly routable; Ranse rejects private and localhost-style URLs. Use **Discover** after saving a server to run MCP `tools/list` and refresh the tool catalog.

Operational checks:

- Rediscovery reconciles the catalog with the server's current `tools/list` response; removed tools disappear from authoring and future runs fail closed.
- MCP HTTP requests have bounded time and response-size limits. Investigate repeated `mcp_http_timeout` or `mcp_response_too_large` failures as server health or contract issues.
- Keep destructive tools on the default approval policy unless the MCP server provides its own idempotency and rollback guarantees.
- Set dollar limits for refund/payment tools; if a configured limit cannot find an amount in the tool arguments, Ranse blocks the call.
- Use per-ticket and per-hour limits to protect internal systems from procedure loops.
- Inspect `mcp_tool_call` for action history and `audit_event` actions prefixed with `mcp.tool_call_` for timeline-level observability.

## Historical evals

Resolved tickets are the regression suite. When an operator marks a ticket `resolved` or `closed`, an autonomous reply records a resolved outcome, or a procedure resolves a ticket, Ranse captures the inbound/outbound transcript into an anonymized `eval_case` if the conversation has both a customer message and a support reply. Operators can also backfill recent cases from **Settings → Evals**.

Capture fails closed if the anonymized payload still contains residual non-placeholder email, phone, or requester-name data. No eval case is written until the redaction rules are safe for that conversation.

CLI workflow:

```bash
# Run inline evals shipped alongside a procedure spec
bun scripts/ranse.ts eval procedures/refund-intake.yaml

# Backfill resolved conversations from a deployed workspace
bun scripts/ranse.ts eval capture-resolved --app-url "$RANSE_APP_URL" --cookie "$RANSE_COOKIE" --limit 100

# Replay active historical cases through current retrieval + drafting
bun scripts/ranse.ts eval --app-url "$RANSE_APP_URL" --cookie "$RANSE_COOKIE" --threshold 0.35 --score-drop 0.15 --ci
```

Eval runs write `eval_run` and `eval_result` rows with assertion details. A run fails when any active case fails or regresses. `regression_count` is reserved for cases with a prior baseline that got worse: previous pass → current fail, or a score drop larger than the configured threshold. Archive noisy cases from **Settings → Evals** instead of deleting them.

The bundled GitHub Actions workflow always runs procedure evals for relevant PRs; set `RANSE_APP_URL` and `RANSE_COOKIE` repository secrets to make hosted historical replay part of the gate.

## Procedure library

Owners and admins can install vetted procedure templates from **Settings → Procedures**. Installed library procedures are published as immutable procedure versions with `source_ref = library:<slug>@<version>`.

Local fork workflow:

```bash
bun scripts/ranse.ts procedure list
bun scripts/ranse.ts procedure add shipping-dispute --dir procedures
bun scripts/ranse.ts eval procedures/shipping-dispute.yaml
```

The CLI writes the procedure spec plus `<slug>.mcp.json`, which documents the reference MCP tools expected by that workflow. Treat those MCP specs as contracts: either implement matching MCP tools, map the procedure to your own server/tool names, or remove the relevant action before publishing.

## Escalations

The `EscalationAgent` runs on demand. It returns `{ should_escalate, severity, route_to }` and the operator (or an automation rule) picks the handoff target.

An **SLA sweep** runs every 5 minutes via a Cron Trigger (`*/5 * * * *`). It walks every workspace, computes first-response / resolution breaches against `DEFAULT_SLA`, and writes a dedup'd `ticket.sla_breached.{first_response|resolution}` audit event the first time each threshold is crossed. Surface these in your own dashboard by querying `audit_event WHERE action LIKE 'ticket.sla_breached.%'`.

## Rotating secrets

```bash
# Replace a provider API key
wrangler secret put OPENAI_API_KEY

# Replace the cookie signing key (will invalidate all sessions)
wrangler secret put COOKIE_SIGNING_KEY

# BYOK keys live in the UserSecretsStore DO, not Worker secrets.
# Users can rotate their own in Settings → LLM providers.
# MCP server secrets also live in UserSecretsStore and can be replaced in Settings → MCP actions.
```

## Incident playbook

**"The AI is replying with garbage."** — Open **Settings → Model per agent action** and switch `draft` to a stronger model (e.g. `anthropic/claude-sonnet-4-6`). Or disable auto-draft by setting the draft action's policy to "manual only" (Phase 2).

**"We want a safer auto-send rollout."** — Use **Settings → Mailboxes** to lower the autonomy rollout percentage. The bucket is deterministic per mailbox/ticket, so repeated scheduled retries make the same send-vs-approval decision.

**"Customer feedback links are missing."** — Set `APP_URL` to your public Worker origin and redeploy. Ranse skips feedback links when `APP_URL` or `COOKIE_SIGNING_KEY` is unavailable because the links must be absolute and signed.

**"Auto-reply loop."** — Ranse detects `Auto-Submitted`, `Precedence`, `X-Autoreply` headers and suppresses responses. If a loop still happens, temporarily pause the mailbox:
```sql
UPDATE mailbox
   SET autonomy_policy = 'draft_only', auto_reply_policy = 'off'
 WHERE address = 'support@acme.com';
```

**"Provider is down."** — Each agent action has a `fallback_model`. The dispatcher retries 3× with exponential backoff, then fails over. Set a fallback in **Settings → Model per agent action**.

## Upgrades

```bash
git pull origin main
bun install
bun run db:migrate:remote
bun run deploy
```

Migrations are forward-only. Rollback by re-deploying the prior Git tag (D1 doesn't support down-migrations; schema changes should be additive).

## Observability

Cloudflare's `observability.enabled: true` is on by default — head to **Workers → ranse → Observability** for logs. Queue retries and DO alarms show up there too.

For custom metrics, the audit trail (`audit_event` in D1) is the source of truth. Every state change the UI performs writes an audit row.
