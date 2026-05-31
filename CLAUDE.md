# Ranse — contributor notes

## Server layout

**`src/lib/`** is the shared utilities root, used by both client and server. It contains general-purpose modules — `crypto`, `ids`, `url-security`, `errors`, `files`, `format`, `password`, `secrets`, `storage`, `decision-trace-page`, `feedback-links`, and the **`lib/llm/`** inference subsystem (`core`, `infer`). **The one rule**: a module that runs database queries (`env.DB.prepare(...)`) does not belong here — it belongs in `src/server/actions/` instead, regardless of how "util-like" it looks.

**`src/config/`** is the system-wide static configuration root — operator-tunable defaults, thresholds, retention windows, retry caps, and registries. One file per domain (`audit`, `auth`, `autonomy`, `channels`, `insights`, `jobs`, `knowledge`, `llm`, `mcp`, `memory`, `procedures`, `sla`). New tunable knobs go here; do not declare `const DEFAULT_X = …` / `const MAX_X = …` inline in implementation files. Algorithm-fixed values (AES IV size, HMAC parameters, embedding model identifiers) stay colocated with the algorithm — those aren't "config," they're protocol.

`src/server/` groups domain features into three buckets, with framework/infra at the root:

- **`inbox/`** — receiving and responding to customer conversations: `agents`, `channels`, `email`, `notifications`.
- **`automation/`** — what the AI knows and does: `knowledge`, `memory`, `mcp`, `procedures`, `evals`.
- **`platform/`** — the workspace/tenant and how it's doing: `workspaces`, `onboarding`, `insights`, `outcomes`, `billing`.
- **`actions/`** — the **DB-action layer**: every module that runs D1 queries (`approvals`, `audit`, `auth`, `decision-trace`, `evals`, `mcp`, `memory`, `procedures`). New code that queries the DB goes here, named by domain. Higher-level orchestration stays in its feature module and calls into `actions/`.
- **root** — `http`, `jobs`, `schemas`, plus `index.ts`/`env.ts` (worker entry).

A bucket must earn its keep: group features only when it shortens a genuinely long flat list. Don't create a bucket for two or three small modules — keep buckets balanced and substantial (the `inbox`/`automation`/`platform` split, not a thin `accounts`-style folder). Add a new feature module under the bucket it belongs to; only add a top-level bucket when a cohesive cluster of features fits none. A module is a flat `module.ts` until it needs ≥2 files, then it becomes a folder (use a thin `index.ts` only as a deliberate public API, not a re-export dump).

## Implementation quality bar

All implementations must be production-quality by default: reusable code in focused modules, consistent naming and structure with the existing codebase, dynamic behavior that adapts to real data instead of brittle hardcoded checks, explicit failure handling, no partial or failed state presented as valid data, and tests for the risky success and failure paths. Prefer behavior-level tests and explicit domain constants/invariants over assertions that only prove a string or branch exists. Do not mark a roadmap phase shipped until this bar is met.

All shared/cross-module types live under a single root, **`src/types/`**, split by audience — never in a `types/` folder under `src/client/` or `src/server/`:

- **`src/types/shared/`** — used by both client and server. Defined by its dependency role: everything here must be safe to import from either side, so it must never import server-only code (e.g. the Worker `Env`) or browser-only DOM types.
- **`src/types/server/`** — server-only contracts (anything taking `Env`, `Request`, `Response`). May import from `src/types/shared/` and from server runtime (e.g. `Env`).
- **`src/types/client/`** — client-only view models / API-response shapes. May import from `src/types/shared/`.

Domain files are named consistently across the three (e.g. `channels.ts` exists in each: shared DTOs, the server `ChannelAdapter` contract, the client view models). Imports flow *downward only* — `client` and `server` may import `shared`, never the reverse or sideways. A type used within a single module stays colocated next to that implementation (e.g. `notifications/channels/types.ts`); promote it to `src/types/<audience>/` once a second module needs it. Keep modules focused: 100–150 lines is the target average, under 300 lines is the normal ceiling. If a file grows past 300 lines, split it by responsibility before adding more behavior.

### Interfaces

Every `interface` declaration lives in **`src/interfaces/<domain>.ts`** — one flat folder, one file per domain (`channels`, `procedures`, `tickets`, `knowledge`, `notifications`, `agents`, `lib`, `http`, `client`, `env`, …). Implementation and type-alias files never declare `interface` directly; they `import type { Foo } from '<...>/interfaces/<domain>'` and re-export `Foo` if it was originally part of their public API. Use plural domain names (`procedures.ts`, `tickets.ts`) and place a new interface in the existing domain file that owns it — only create a new domain file when nothing fits.

## Validation schemas (zod)

Every zod schema lives in `src/server/schemas/<name>.ts`, never inline in implementation files. This covers HTTP request bodies, LLM structured-output contracts (triage/draft/escalation/summarize/assist), event payloads, the procedure-spec DSL, and anything else built with `z.`. Implementation files import the schema (and its `z.infer` type) and use it; they don't declare zod themselves. Where a result type was historically exported from its implementation file (e.g. `TriageResult` from `specialists/triage.ts`), the implementation file re-exports it from the schema module so existing importers keep working without churn. A handler holds logic, an agent holds prompt + inference call, a registry holds event metadata — but the schemas themselves all live in one place.

## Commit messages

Use terse Conventional Commit-style subjects: `type(scope): short summary`. Scope is optional. Keep the subject under 72 characters, use imperative mood, and avoid filler. Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `style`. Examples: `feat(knowledge): add vectorized retrieval`, `fix(email): preserve reply threading headers`, `refactor(api): split route modules`. Avoid vague or AI-sounding subjects like `improve code quality`, `implement comprehensive solution`, or `update files`.

## Migrations

New migrations use a **timestamp prefix**, not a sequential counter:

```
YYYYMMDD_HHMMSS_<short_name>.sql
```

Example: `20260503_120000_notification_channels.sql`.

Why: `wrangler d1` sorts the `migrations/` directory alphabetically and applies anything not in the `d1_migrations` tracking table — it doesn't care about the format. Sequential numbering (`0004_`, `0005_`, ...) silently breaks when two contributors land migrations on parallel branches with the same number. Timestamps remove the collision.

Old migrations (`0001_init.sql` through `0005_notification_channels.sql`) stay as-is — `0` < `2` alphabetically, so old + new sort correctly together. **Don't rename applied migrations** — `wrangler` keys the tracking table on filename, so a rename re-runs the migration under the new name.

Create with `wrangler d1 migrations create ranse-db <name>`, then **rename the generated `0006_<name>.sql` to the timestamp form** before committing.
