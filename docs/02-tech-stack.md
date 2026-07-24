# 02 — Tech Stack

The stack is deliberately small: Cloudflare primitives for infrastructure, a thin set of
libraries on top. Read this before adding any dependency.

## Runtime (Cloudflare)

| Primitive | Used for |
| --- | --- |
| Workers | the entire app — API, UI serving, email handler, one deployable unit |
| Durable Objects | `WorkspaceSupervisorAgent`, `MailboxAgent`, `ProcedureRunnerAgent`, `UserSecretsStore` |
| D1 | relational store — tickets, messages, approvals, audit, procedures, billing |
| R2 | raw inbound MIME, attachments, exports |
| KV | caches and lightweight flags |
| Queues | `ranse-jobs`, `ranse-webhooks` — async delivery, retries, DLQ |
| Vectorize | knowledge-base embeddings and retrieval |
| AI Gateway | every LLM call, via the `/compat` endpoint |
| Email Routing / Email Sending | inbound mail to the Worker; DKIM-signed outbound |
| Workers AI | default zero-key LLM provider |

## Application libraries

- **Hono** — HTTP routing.
- **Agents SDK** (`agents`) — Durable Object agent classes. Uses TC39 standard decorators;
  never enable `experimentalDecorators`.
- **React 19 + Vite** — operator console.
- **zod** — every boundary validation; schemas live in `src/server/schemas/`.
- **openai** (SDK) — the single LLM dispatch path (`src/lib/llm/`) against AI Gateway
  `/compat`, which is what makes providers swappable per action. See
  [ADR-0002](adr/0002-ai-gateway-compat-llm-dispatch.md).
- **postal-mime** — inbound MIME parsing.
- **yaml** — procedure specs.

## Tooling

- **bun** — package manager and script runner (`.nvmrc` pins Node 22 for node-based tools).
- **Biome** — lint + format, single source of truth; runs on staged files via lint-staged.
- **Vitest** — unit tests; procedure/eval suites gate CI.
- **wrangler** — local dev, D1 migrations, deploy.
- **commitlint + husky** — Conventional Commits enforcement.
- **Changesets** — changelog and versioning.

## Dependency policy

1. **Cloudflare-native first.** Prefer DOs, D1, R2, KV, Queues, Vectorize, and AI Gateway over
   any external service — external infrastructure breaks the one-click, customer-owned deploy.
2. **Justify every new package.** It must do something a Cloudflare primitive or ~50 lines of
   focused code cannot. Heavy transitive trees are a no.
3. **No SSR frameworks, no ORMs.** Raw prepared D1 statements in `src/server/actions/` are the
   data layer.
4. Dependencies are pinned via `bun.lock` and scanned by Dependabot weekly.
