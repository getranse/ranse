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
- `insights` — conversation rubric scoring, aggregate operational metrics, unresolved-intent KB suggestions, and knowledge drift detection.
- `channels` — public chat/form channel configuration, origin-scoped session tokens, hosted forms, widget script, and ticket creation.
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
| D1 | Tickets, messages, audit, approvals, outcomes, feedback, daily rollups, users, sessions, knowledge, LLM config, procedures, MCP registry/tool calls, eval cases/runs/results, conversation scores, KB suggestions, drift signals, public channels/sessions |
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
  │    └─ compare library MCP contracts against discovered workspace MCP tools
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

The built-in catalog is code, not database state, so deploys carry the exact procedure specs, evals, and reference MCP contracts reviewed in git. List/detail responses include deterministic SHA-256 provenance, the Ranse procedure schema version, MCP readiness for the selected workspace, and the MCP schema version used for reference ToolAnnotations. Validation requires each required MCP reference to be exercised by a `call_action` step; write and destructive actions cannot opt out of approval.

## Insights loop

```
Weekly cron / manual refresh
  ├─ score recent tickets on groundedness, tone, resolution, and customer effort
  ├─ aggregate resolution, follow-up, feedback, unresolved-intent, and procedure-latency metrics
  ├─ cluster repeated unresolved conversations into confidence-scored KB article suggestions
  ├─ compare cited KB sources against successful replies for source-specific drift signals
  └─ prune old recomputable conversation score rows

Insights page
  ├─ POST /api/insights/scores/run
  ├─ POST /api/insights/kb-suggestions/run
  ├─ POST /api/insights/kb-suggestions/:id/accept
  └─ POST /api/insights/drift/run
```

Suggestions are review records, not automatic content edits. They require repeated unresolved-ticket evidence, store confidence and source-ticket lineage, and accepted suggestions become terminal records linked to the manual knowledge source created through the same ingestion path as the Content Library.

Scheduled insights maintenance is workspace-isolated: one workspace failure is returned as an `ok: false` result for that workspace instead of failing the entire cron run.

## Public web channels

```
Settings -> Public channels
  ├─ create chat/form channel for a workspace mailbox
  ├─ configure allowed origins, welcome text, and email requirement
  └─ copy <script src="/widget/<public_key>.js"> or /forms/<public_key>

Visitor browser
  ├─ GET /public/channels/:key/config
  ├─ POST /public/channels/:key/sessions
  ├─ POST /public/sessions/:id/messages
  └─ GET /public/sessions/:id
       └─ reads only with the bearer session token
```

Public channels are derivatives of the ticket model, not a separate inbox. A chat or form submission creates a normal `ticket`, stores inbound text in `message_index` plus R2, emits the same notification events, records audit rows, starts ticket-created procedures, and lets operators answer from the existing ticket console. Origin allowlists and unguessable session tokens scope public browser access; internal notes are never returned through public session reads.

## Channel adapters (Phase 9.1)

Every async surface — chat widget, hosted form, Slack, SMS, Discord, Telegram, WhatsApp — implements the same `ChannelAdapter` contract in `src/channels/adapters/`:

```ts
interface ChannelAdapter {
  kind: ChannelKind;
  capabilities: ChannelCapabilities;
  validateConfig(input: unknown): Record<string, unknown>;
  onActivate?(env, channel): Promise<void>;
  verifyWebhook(env, channel, headers, rawBody): Promise<{ ok: boolean; reason?: string }>;
  parseIngress(env, channel, headers, rawBody): Promise<IngressMessage | null>;
  handleChallenge?(env, channel, request): Promise<Response | null>;
  egress(env, channel, message): Promise<EgressResult>;
}
```

Inbound flow for any third-party channel:

```
POST /public/channels/:key/webhook
  └─ getPublicChannelByKey(key)
       └─ adapter = getAdapter(channel.kind)
            ├─ adapter.handleChallenge?(req)   # Slack url_verification, Meta hub.challenge, Discord PING
            ├─ adapter.verifyWebhook(headers, rawBody)
            ├─ adapter.parseIngress(rawBody) → IngressMessage | null
            └─ ingestInboundMessage(channel, msg)
                 ├─ dedup on (workspace, channel, external_id)
                 ├─ resolveCustomerIdentity(...) → customer_id (stitch by email/phone)
                 ├─ open new ticket OR continue existing thread (channel.id + customer_id)
                 ├─ message_index INSERT + R2 body
                 ├─ emit ticket.created / message.inbound
                 └─ startTriggeredProcedureRuns(channel: { kind, capabilities })
```

Outbound flow when an operator (or autonomous reply pipeline) sends a reply:

```
sendThreadedReply
  ├─ loadReplyContext(ticket) → { origin_channel_kind, origin_channel_id, ... }
  ├─ if origin_channel_kind === 'email': use the legacy MIME + reply-address pipeline.
  └─ else: dispatchOutbound({ ticketId, messageId, text, fromName })
       ├─ load public_channel by ticket.origin_channel_id
       ├─ getAdapter(kind).egress(channel, message)
       ├─ record channel_outbound_dispatch { status, attempts, last_error, external_id }
       └─ stamp message_index.rfc_message_id with the external thread id so the
          next inbound reply continues the same ticket
```

Identity stitching:

- One row in `customer` per person; one row in `channel_identity` per (channel, external_id).
- Stitching is conservative: when an ingress payload carries an email or phone that already exists on another identity (or on a customer's primary contact), we reuse that customer; otherwise we open a fresh customer. Operators can manually merge in the UI later.
- This is what gives the operator a single chronological history when the same person reaches out over email today and SMS tomorrow.

Capabilities + procedures:

- Each adapter exports a `ChannelCapabilities` map (`supportsOtpDelivery`, `supportsButtons`, `supportsRichText`, `maxMessageLength`, …).
- Procedures receive `channel.capabilities` in their evaluation context and can branch on it with `if { var: 'channel.capabilities.supportsOtpDelivery', equals: true }`.
- The reference library procedure `verify-identity-channel-aware` shows the pattern: SMS/Telegram/WhatsApp tickets go through OTP, chat/form fall back to a magic link over email.

Adding a new channel:

1. Implement `ChannelAdapter` in `src/channels/adapters/<kind>.ts` (capability map, signature verify, parse, egress).
2. Register it in `src/channels/adapters/index.ts`.
3. Add the kind to `ChannelKind` and `PUBLIC_CHANNEL_KINDS` in `src/types/channels.ts`.
4. Add the kind to the settings UI's `CHANNEL_KINDS` and `CONFIG_FIELDS` map.

No schema migration is needed — config is opaque JSON the adapter validates.

## Voice (Phase 9 voice)

Voice is a single `ChannelAdapter` (`kind = 'voice'`) that delegates to one of three pluggable provider modules selected by `config.provider`:

| Provider           | Inbound media path                                  | Reply path                                            | Best for                                          |
|--------------------|-----------------------------------------------------|-------------------------------------------------------|---------------------------------------------------|
| `elevenlabs`       | Provider-owned phone number → ElevenLabs agent      | Post-call webhook delivers full transcript + audio    | Fastest setup, managed agent, premium voice       |
| `twilio_realtime`  | Twilio Voice number → `<Stream>` to Worker WS       | Worker bridges Whisper (STT) + LLM + MeloTTS in-flight| Self-hosted, single-stack Cloudflare deploy       |
| `gemini_live`      | Browser/Twilio WS → Worker WS → Gemini Live         | Native bidi audio from Gemini                         | Best latency + native multimodal                  |

Data model:

- `voice_call` — one row per phone call. Tracks status (ringing → connected → completed/failed/missed), caller/callee numbers, duration, R2 keys for full recording + transcript, summary, agent mode (`autonomous` | `human` | `mixed`).
- `voice_call_turn` — every utterance (caller) and every reply (agent), with per-turn audio R2 key, model name, latency, optional confidence and interruption flag.
- `voice_provider_event` — raw provider payloads (signed-webhook bodies, status callbacks) stored to R2 with a D1 index for replay/debugging.

Every turn is also written to `message_index` with `direction='inbound'` (caller) or `'outbound'` (agent) and `rfc_message_id = voice:<channel_id>:thread:<external_call_id>:<seq>` so the existing reply pipeline, procedures, identity stitching, and operator UI see voice tickets transparently.

Webhook + WebSocket routing:

```
/public/channels/:key/webhook
  ├─ ?answer=1  POST  → provider.answerCall() returns TwiML <Connect><Stream/>
  ├─ POST              → provider.parseEvent() (post-call transcript / status callback)
  └─ Upgrade: websocket → provider.handleStream() bridges audio in real time

/public/channels/:key/voice/ws  → friendly alias for the WebSocket upgrade,
                                  used by the browser-side Gemini Live client.
```

Capability flags exposed to procedures: `supportsVoice`, `supportsStreaming`, `supportsOtpDelivery` (true — an agent can read OTP aloud), `maxMessageLength: 600`. Procedures branching on `channel.capabilities.supportsVoice === true` should keep replies short, avoid links and dictation-only material, and prefer SMS/email follow-up for anything the customer would have to write down.

Adding a new voice provider:

1. Implement `VoiceProviderModule` in `src/channels/voice/providers/<kind>.ts` (`validateConfig`, `verifyEvent`, `parseEvent`, optionally `answerCall` + `handleStream`).
2. Register it in `src/channels/voice/index.ts`.
3. Add the provider kind to `VoiceProviderKind` and `VOICE_PROVIDER_KINDS` in `src/types/channels.ts`.
4. Add a UI option entry to `PublicChannelsSection.tsx` (`KIND_OPTIONS` + `CONFIG_FIELDS`).

No schema migration required.

## Customer preferences, encryption, cascade, retries (Phase 9 final)

**Secret encryption at rest.** Each `ChannelAdapter` declares `secretFields: string[]` for the credential keys in its config. The admin layer (`channels/admin.ts`) splits the validated config on persist into `config_json` (plaintext, indexable, visible in operator UI) and `secrets_ciphertext` (AES-GCM-256, IV per write, workspace-derived key via HKDF-SHA256 with the workspace id as salt against `env.SECRET_ENCRYPTION_KEY`). On read, `parseChannelConfigAsync(env, channel)` decrypts and merges; the synchronous `parseChannelConfig` returns only the plaintext half (capability lookups, UI rendering). Existing channels with plaintext `config_json` keep working — the read path tolerates the legacy format and the next save re-seals.

**Customer channel preferences.** `customer_channel_preference (workspace, customer, channel_kind, status, quiet_hours_*, timezone)` rows let customers opt in/out per surface. `canDeliverTo()` is called by both the outbound dispatcher and the cascade engine; `opted_out` is a hard block (no retry), `quiet_hours` schedules the next retry to the window edge. STOP/UNSUBSCRIBE/CANCEL keywords on inbound text auto-disable the channel via `applyStopKeyword` — wired into `channels/ingress.ts` so every adapter benefits.

**Omnichannel notification cascade.**

```
notifyCustomer({ workspaceId, customerId, ticketId?, templateSlug?, payload, urgency, cascade? })
  ├─ resolve template (default channels + per-channel bodies) or use explicit cascade
  ├─ insertPlan(...) + insertStep(...) for each step
  └─ advancePlan(plan) → fireStep(first) immediately

scheduled tick (cascade-sweep, every 5 minutes)
  ├─ findPlansDueBefore(now) → due steps across active plans
  ├─ canDeliverTo() preference check; skip step + schedule next on block
  ├─ dispatchOutbound(ticket, message) through the adapter for that step's channel
  ├─ updateStepStatus('sent' | 'failed' | 'skipped') + recordDeliveryEvent
  └─ scheduleNextStepAfter() based on trigger_on rules

inbound on any channel (channels/ingress.ts)
  └─ acknowledgePlansForCustomer(workspace, customer, channelKind)
       └─ matching sent step → status='read', plan='completed'
```

Cascade step `trigger_on` values: `immediate`, `previous_failed`, `previous_unread`, `previous_no_ack`, `time_elapsed`. Default inter-step delay is urgency-aware (urgent: 1m, high: 5m, normal: 30m, low: 4h). Templates carry per-channel bodies under `bodies_json` and render `{{ payload.foo }}` at materialize-time.

**Retry queue + DLQ.** `channel_outbound_dispatch` gained `next_attempt_at` + `max_attempts`. Failed sends schedule the next attempt with `retryBackoffMs(attempt)` — 60s, 5m, 30m, 2h, 8h with ±10% jitter — and the `dispatch-retry-sweep` job (5-minute cadence, sharing the SLA-sweep heartbeat) calls `retryPendingDispatch(id)` which re-fires the adapter and either upgrades the row to `delivered`, schedules the next backoff slot, or settles to `failed` after `max_attempts`. Preference-blocked sends never get a retry slot.

**Generic outbound webhook.** The `webhook` adapter is the meta-channel: HMAC-SHA256 signed in both directions, JSON body for inbound (`{ external_id, external_thread_id, text, from: {…} }`) and outbound (`{ kind, message, sent_at }`). Operators paste an `endpoint_url` + `shared_secret` and a custom-headers JSON blob — they can route Ranse into any internal system without writing a new adapter or shipping new code.

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
