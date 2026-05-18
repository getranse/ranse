# Architecture

Ranse is a single Cloudflare Worker app with four Durable Object classes, structured around a **workspace-centered multi-agent orchestration model**.

## Top-level agents

- **`WorkspaceSupervisorAgent`** — one DO per workspace. Receives events, loads workspace policy, delegates to specialists, decides what side effects are allowed, broadcasts state.
- **`MailboxAgent`** — one DO per support mailbox. Tracks ingest counters and duty-cycle flags.
- **`UserSecretsStore`** — one DO per workspace. Holds AES-GCM-encrypted BYOK provider keys.
- **`ProcedureRunnerAgent`** — one DO per procedure run. Executes version-pinned procedure steps, checkpoints progress in D1, pauses for customer or approval events, and resumes MCP actions after approval.

## Specialist sub-agents

Function-based, not DOs. They live in `src/agents/specialists/` and return structured results via Zod-validated JSON schemas:

- `triage` — category, priority, sentiment, language, spam detection.
- `summarize` — thread summary + next-step hint.
- `knowledge` — manual/URL/PDF/resolved-ticket ingestion, Workers AI embeddings, Vectorize search, reranking, and keyword fallback.
- `draft` — generate a reply with citations; flag review risks.
- `escalation` — decide whether to route to a human/team.
- `sla` — deterministic, no LLM; computes breach status.

## Event flow (inbound email)

```
email() handler
  ├─ RATE_LIMIT_INGEST.limit(from)
  ├─ parseInbound (postal-mime → ParsedInbound)
  ├─ resolveMailboxForRecipients (D1: match direct address or reply+<tkt>.<sig>@...)
  ├─ BLOB.put(raw/{ws}/{mb}/{mid}.eml, rawBytes)
  ├─ MailboxAgent.recordInbound
  └─ WorkspaceSupervisorAgent.ingestEmail
       ├─ find-or-create ticket (thread by In-Reply-To, References, then 72h fallback)
       ├─ insert message_index row
       ├─ audit ticket.created | ticket.message_received
       ├─ record customer_followed_up outcome when a closed/pending ticket reopens
       └─ this.schedule(0, 'triageAndDraft', …)

triageAndDraft (runs in DO alarm, async)
  ├─ skip if this inbound already has a pending approval or threaded reply
  ├─ runTriage (LLM) → category/priority/sentiment
  ├─ (if spam) mark status, stop
  ├─ agenticSearchKnowledge (bounded multi-hop Vectorize/keyword/rerank loop)
  ├─ runDraft (LLM) with retrieved evidence
  ├─ score autonomy (LLM confidence + retrieval score + groundedness + freshness)
  ├─ mailbox policy gate → auto-send or createApproval (pending)
  └─ audit approval.created | reply.auto_sent
```

## Storage model

| System | Purpose |
|---|---|
| DO SQLite | Workspace state, mailbox counters, BYOK-encrypted secrets |
| D1 | Tickets, messages, audit, approvals, outcomes, feedback, daily rollups, users, sessions, knowledge, LLM config, procedures, MCP registry/tool calls, eval cases/runs/results |
| R2 | Raw MIME, text/html bodies, attachments, exports |
| KV | Rate limits, idempotency, lightweight flags |
| Vectorize | Per-workspace knowledge chunk embeddings |
| Queues | Webhook delivery, async jobs, retries |

## R2 key layout

```
raw/{workspaceId}/{mailboxId}/{messageId}.eml
bodies/{workspaceId}/{ticketId}/{messageId}.{txt|html}
attachments/{workspaceId}/{ticketId}/{attachmentId}/{filename}
knowledge/{workspaceId}/{sourceId}/{filename}
exports/{workspaceId}/{exportId}.zip
```

## Multi-provider LLM

All LLM calls funnel through `src/llm/infer.ts` → `src/llm/core.ts`. Provider choice is carried in the model name string (`anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`, etc.).

Resolution precedence for API keys:
1. Per-request runtime override (from `UserSecretsStore`)
2. Worker secret (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …)
3. AI Gateway token (`CLOUDFLARE_AI_GATEWAY_TOKEN`) for BYOK-wholesale

Base-URL resolution:
1. If `CLOUDFLARE_AI_GATEWAY_URL` set → Gateway URL (+ `/compat` or `/{provider}` path).
2. Else if `AI` binding present → `env.AI.gateway(name).getUrl()`.
3. Else → direct provider URL.

The `/compat` endpoint lets us use a single `new OpenAI({ baseURL, apiKey })` client for every provider, since Gateway translates OpenAI chat-completions requests to each provider's native format.

Fallback: each action in `DEFAULT_AGENT_CONFIG` can declare a `fallbackModel`. After `maxAttempts` failures on the primary, we switch to the fallback and retry with exponential backoff.

## MCP action flow

```
ProcedureRunnerAgent
  ├─ call_action step resolves mcp_server + mcp_tool
  ├─ enforce guardrails in D1 (approval, rate, amount, segment, enabled)
  ├─ if approval required: create approval_request(kind = call_external), wait
  ├─ approval route marks decision and resumes the same ProcedureRunnerAgent
  ├─ Streamable HTTP MCP initialize → notifications/initialized → tools/call
  ├─ write mcp_tool_call status/result/error
  └─ audit mcp.tool_call_{approval_requested|completed|failed|blocked|rejected}
```

MCP server secrets are stored in `UserSecretsStore` under `mcp:<serverId>`. D1 stores endpoint metadata, discovered tool schemas, annotations, guardrail configuration, and immutable call records.

## Eval flow

```
Ticket is resolved
  ├─ setTicketStatus(resolved|closed), autonomous outcome, or procedure status step
  ├─ captureResolvedTicketEvalCase
  │    ├─ load ticket + inbound/outbound transcript
  │    ├─ anonymize email, phone, and requester-name fields
  │    ├─ reject capture if residual PII remains
  │    └─ upsert eval_case(source = resolved_ticket)
  └─ audit eval.case_captured

ranse eval / Settings -> Evals
  ├─ create eval_run
  ├─ for each active eval_case
  │    ├─ agenticSearchKnowledge with current retrieval prompts/config
  │    ├─ runDraft with current draft prompt/model config
  │    ├─ score reply overlap, required terms, confidence signals
  │    ├─ compare against latest prior baseline result
  │    └─ insert eval_result
  └─ mark eval_run passed/failed
```

Procedure evals are local and deterministic. `ranse eval <procedure-file>` loads the spec, runs each inline `evals[]` case through `simulateProcedure`, and checks expected status, context paths, and step order before a PR is merged.

## Procedure library flow

```
Settings -> Procedures
  ├─ GET /api/procedures/library
  ├─ GET /api/procedures/library/manifest
  ├─ POST /api/procedures/library/:slug/install
  └─ upsertProcedureVersion(source_kind = seed, source_ref = library:<slug>@<version>#sha256:<checksum>)

ranse procedure add <slug>
  ├─ read built-in catalog from src/procedures/library-data.ts
  ├─ validate inline evals
  ├─ write procedures/<slug>.yaml
  ├─ write procedures/<slug>.mcp.json
  └─ write procedures/<slug>.provenance.json
```

The built-in catalog is code, not database state, so deploys carry the exact procedure specs, evals, and reference MCP contracts reviewed in git. List/detail responses include deterministic SHA-256 provenance, the Ranse procedure schema version, and the MCP schema version used for reference ToolAnnotations.

## Scaling model

- One `WorkspaceSupervisorAgent` DO per workspace. The email handler pins by `idFromName(workspaceId)` so all events for a workspace funnel through one instance — consistent state, no cross-DO coordination needed.
- Busy workspaces remain responsive because triage/draft runs via `this.schedule()` (alarm-based), not inline in the email handler.
- D1 handles cross-workspace queries (admin tools, reporting). Hot state stays in DO memory + SQLite.

## Design decisions

- **No per-ticket DOs in v1.** Tickets are relational rows in D1. If/when we need per-ticket agent identity (presence, live collaboration, per-ticket reinforcement learning), we can introduce `TicketAgent` without changing the supervisor's public API.
- **OpenAI SDK as universal client.** Matches vibesdk. Avoids the weight of Vercel AI SDK; Gateway's OpenAI-compat endpoint unifies everything.
- **Approvals are data, not code.** Risky AI replies are `approval_request` rows until a human acts. The mailbox autonomy gate decides whether a grounded draft can auto-send or must enter the approval queue.
- **Customer feedback is signed.** Outbound replies include HMAC-signed feedback links when `APP_URL` is configured; recipients can rate a reply without a session, and the token only grants feedback on that message.
- **Single Worker repo.** One-click deploy works best with isolated apps; splitting into monorepo breaks the UX.
