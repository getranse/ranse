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

- Keep destructive tools on the default approval policy unless the MCP server provides its own idempotency and rollback guarantees.
- Set dollar limits for refund/payment tools; if a configured limit cannot find an amount in the tool arguments, Ranse blocks the call.
- Use per-ticket and per-hour limits to protect internal systems from procedure loops.
- Inspect `mcp_tool_call` for action history and `audit_event` actions prefixed with `mcp.tool_call_` for timeline-level observability.

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
