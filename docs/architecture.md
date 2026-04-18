# Architecture

Ranse is a single Cloudflare Worker app with three Durable Object classes, structured around a **workspace-centered multi-agent orchestration model**.

## Top-level agents

- **`WorkspaceSupervisorAgent`** — one DO per workspace. Receives events, loads workspace policy, delegates to specialists, decides what side effects are allowed, broadcasts state.
- **`MailboxAgent`** — one DO per support mailbox. Tracks ingest counters and duty-cycle flags.
- **`UserSecretsStore`** — one DO per workspace. Holds AES-GCM-encrypted BYOK provider keys.

## Specialist sub-agents

Function-based, not DOs. They live in `src/agents/specialists/` and return structured results via Zod-validated JSON schemas:

- `triage` — category, priority, sentiment, language, spam detection.
- `summarize` — thread summary + next-step hint.
- `knowledge` — keyword search over `knowledge_doc` (Phase 2: Vectorize).
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
       └─ this.schedule(0, 'triageAndDraft', …)

triageAndDraft (runs in DO alarm, async)
  ├─ runTriage (LLM) → category/priority/sentiment
  ├─ (if spam) mark status, stop
  ├─ searchKnowledge (D1 LIKE scoring v1)
  ├─ runDraft (LLM) with knowledge + policy
  ├─ policy gate → createApproval (pending)
  └─ audit approval.created
```

## Storage model

| System | Purpose |
|---|---|
| DO SQLite | Workspace state, mailbox counters, BYOK-encrypted secrets |
| D1 | Tickets, messages, audit, approvals, users, sessions, knowledge, LLM config |
| R2 | Raw MIME, text/html bodies, attachments, exports |
| KV | Rate limits, idempotency, lightweight flags |
| Queues | Webhook delivery, async jobs, retries |

## R2 key layout

```
raw/{workspaceId}/{mailboxId}/{messageId}.eml
bodies/{workspaceId}/{ticketId}/{messageId}.{txt|html}
attachments/{workspaceId}/{ticketId}/{attachmentId}/{filename}
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

## Scaling model

- One `WorkspaceSupervisorAgent` DO per workspace. The email handler pins by `idFromName(workspaceId)` so all events for a workspace funnel through one instance — consistent state, no cross-DO coordination needed.
- Busy workspaces remain responsive because triage/draft runs via `this.schedule()` (alarm-based), not inline in the email handler.
- D1 handles cross-workspace queries (admin tools, reporting). Hot state stays in DO memory + SQLite.

## Design decisions

- **No per-ticket DOs in v1.** Tickets are relational rows in D1. If/when we need per-ticket agent identity (presence, live collaboration, per-ticket reinforcement learning), we can introduce `TicketAgent` without changing the supervisor's public API.
- **OpenAI SDK as universal client.** Matches vibesdk. Avoids the weight of Vercel AI SDK; Gateway's OpenAI-compat endpoint unifies everything.
- **Approvals are data, not code.** Every outbound reply is an `approval_request` row until a human acts. The policy that decides "auto-send vs gate" is in the supervisor — extend there.
- **Single Worker repo.** One-click deploy works best with isolated apps; splitting into monorepo breaks the UX.
