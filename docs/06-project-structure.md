# 06 — Project Structure

Where a file goes. These rules are load-bearing and enforced in review.

## Top level

```text
src/
  auth/         session + password auth
  client/       React operator console
  config/       system-wide static configuration (one file per domain)
  interfaces/   every `interface` declaration (one file per domain)
  lib/          shared utilities used by client and server (incl. lib/llm/)
  server/       the Worker: domain features, actions, http, jobs, schemas
  setup/        first-run setup wizard
  types/        shared/cross-module types, split by audience
migrations/     D1 migrations (timestamp-prefixed — see CLAUDE.md)
scripts/        CLI (`ranse`), deploy, setup, checks
tests/          Vitest suites
```

## `src/lib/` — shared utilities

General-purpose modules used by both client and server — `crypto`, `ids`, `url-security`,
`errors`, `files`, `format`, `password`, `secrets`, `storage`, `decision-trace-page`,
`feedback-links`, and the `lib/llm/` inference subsystem (`core`, `infer`). **The one rule**: a
module that runs database queries (`env.DB.prepare(...)`) does not belong here — it belongs in
`src/server/actions/`, regardless of how "util-like" it looks.

## `src/config/` — tunables

Operator-tunable defaults, thresholds, retention windows, retry caps, and registries. One file
per domain (`audit`, `auth`, `autonomy`, `channels`, `insights`, `jobs`, `knowledge`, `llm`,
`mcp`, `memory`, `procedures`, `sla`). New tunable knobs go here; do not declare
`const DEFAULT_X = …` / `const MAX_X = …` inline in implementation files. Algorithm-fixed
values (AES IV size, HMAC parameters, embedding model identifiers) stay colocated with the
algorithm — those aren't "config," they're protocol.

## `src/server/` — three buckets plus infra

- **`inbox/`** — receiving and responding to customer conversations: `agents`, `channels`,
  `email`, `notifications`.
- **`automation/`** — what the AI knows and does: `knowledge`, `memory`, `mcp`, `procedures`,
  `evals`.
- **`platform/`** — the workspace/tenant and how it's doing: `workspaces`, `onboarding`,
  `insights`, `outcomes`, `billing`.
- **`actions/`** — the **DB-action layer**: every module that runs D1 queries (`approvals`,
  `audit`, `auth`, `decision-trace`, `evals`, `mcp`, `memory`, `procedures`). New code that
  queries the DB goes here, named by domain. Higher-level orchestration stays in its feature
  module and calls into `actions/`.
- **root** — `http`, `jobs`, `schemas`, plus `index.ts`/`env.ts` (worker entry).

A bucket must earn its keep: group features only when it shortens a genuinely long flat list.
Don't create a bucket for two or three small modules — keep buckets balanced and substantial
(the `inbox`/`automation`/`platform` split, not a thin `accounts`-style folder). Add a new
feature module under the bucket it belongs to; only add a top-level bucket when a cohesive
cluster of features fits none. A module is a flat `module.ts` until it needs ≥2 files, then it
becomes a folder (use a thin `index.ts` only as a deliberate public API, not a re-export dump).

## `src/types/` — shared types by audience

All shared/cross-module types live under a single root, split by audience — never in a
`types/` folder under `src/client/` or `src/server/`:

- **`src/types/shared/`** — used by both client and server. Defined by its dependency role:
  everything here must be safe to import from either side, so it must never import server-only
  code (e.g. the Worker `Env`) or browser-only DOM types.
- **`src/types/server/`** — server-only contracts (anything taking `Env`, `Request`,
  `Response`). May import from `src/types/shared/` and from server runtime (e.g. `Env`).
- **`src/types/client/`** — client-only view models / API-response shapes. May import from
  `src/types/shared/`.

Domain files are named consistently across the three (e.g. `channels.ts` exists in each:
shared DTOs, the server `ChannelAdapter` contract, the client view models). Imports flow
*downward only* — `client` and `server` may import `shared`, never the reverse or sideways. A
type used within a single module stays colocated next to that implementation (e.g.
`notifications/channels/types.ts`); promote it to `src/types/<audience>/` once a second module
needs it.

## `src/interfaces/` — interface declarations

Every `interface` declaration lives in **`src/interfaces/<domain>.ts`** — one flat folder, one
file per domain (`channels`, `procedures`, `tickets`, `knowledge`, `notifications`, `agents`,
`lib`, `http`, `client`, `env`, …). Implementation and type-alias files never declare
`interface` directly; they `import type { Foo } from '<...>/interfaces/<domain>'` and
re-export `Foo` if it was originally part of their public API. Use plural domain names
(`procedures.ts`, `tickets.ts`) and place a new interface in the existing domain file that
owns it — only create a new domain file when nothing fits.

## `src/server/schemas/` — zod

Every zod schema lives in `src/server/schemas/<name>.ts`, never inline in implementation
files. This covers HTTP request bodies, LLM structured-output contracts
(triage/draft/escalation/summarize/assist), event payloads, the procedure-spec DSL, and
anything else built with `z.`. Implementation files import the schema (and its `z.infer` type)
and use it; they don't declare zod themselves. Where a result type was historically exported
from its implementation file (e.g. `TriageResult` from `specialists/triage.ts`), the
implementation file re-exports it from the schema module so existing importers keep working
without churn. A handler holds logic, an agent holds prompt + inference call, a registry holds
event metadata — but the schemas themselves all live in one place.

## File size

New files stay **≤ 100 lines** (`bun run lines`); legacy files in
[`scripts/file-size-baseline.json`](../scripts/file-size-baseline.json) may only shrink. See
[07-coding-standards.md](07-coding-standards.md).
