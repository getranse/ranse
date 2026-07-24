# CLAUDE.md

Guidance for AI coding assistants (and humans) working in this repo. Read this first, then the
linked docs before writing code.

## What this is

**Ranse** — the open-source, Cloudflare-native shared inbox for support teams: a single
Cloudflare Worker app (Durable Objects, D1, R2, KV, Queues, AI Gateway) that turns support
email into a multi-agent workspace — triage, retrieval, drafting, procedures-as-code,
MCP-native actions, and evals — **deployed to the customer's own Cloudflare account.
There is no Ranse-hosted backend.**

## Required reading

| Doc | Read when… |
| --- | --- |
| [docs/00-vision.md](docs/00-vision.md) | you need scope / non-goals |
| [docs/01-architecture.md](docs/01-architecture.md) | touching agents, storage, or event flow |
| [docs/02-tech-stack.md](docs/02-tech-stack.md) | adding a dependency or tool |
| [docs/03-installation.md](docs/03-installation.md) | setup, deploy-button flow, DNS |
| [docs/04-operations.md](docs/04-operations.md) | ticket lifecycle, approvals, escalations, procedures |
| [docs/05-security.md](docs/05-security.md) | auth, roles, reply signing, auto-reply handling |
| [docs/06-project-structure.md](docs/06-project-structure.md) | where a file goes |
| [docs/07-coding-standards.md](docs/07-coding-standards.md) | always |
| [docs/08-roadmap.md](docs/08-roadmap.md) | scope and what phase a feature belongs to |
| [docs/adr/](docs/adr/) | the "why" behind big decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | ground rules and the PR workflow |

## Hard rules (non-negotiable)

1. **One Worker repo.** Ranse stays deployable as a single Cloudflare Worker app. No monorepo
   tooling, no service splits — the one-click deploy breaks.
2. **≤ 100 lines per file** for new files, enforced by `bun run lines` in CI. Legacy files in
   [scripts/file-size-baseline.json](scripts/file-size-baseline.json) may only shrink — leave
   them smaller than you found them. Split by responsibility before hitting the limit.
3. **Conventional Commits** (`type(scope): subject`), one focused feature/fix per commit —
   enforced by commitlint. See [Commit messages](#commit-messages).
4. **No AI authorship.** Never add Claude, Copilot, or any AI tool as a commit author or
   `Co-Authored-By` trailer. Commits belong to the human contributor only.
5. **TypeScript strict, no `any`.** Validate all boundary data (HTTP bodies, LLM structured
   output, event payloads) with zod schemas in `src/server/schemas/`.
6. **Cloudflare-native, minimal dependencies.** Prefer DOs, D1, R2, KV, Queues, and AI Gateway
   over external services. No `experimentalDecorators` — the Agents SDK uses TC39 decorators.
7. **Layout rules are load-bearing.** DB queries only in `src/server/actions/`; interfaces only
   in `src/interfaces/`; shared types only in `src/types/`; tunables only in `src/config/`;
   zod schemas only in `src/server/schemas/`. Full rules:
   [docs/06-project-structure.md](docs/06-project-structure.md).

## Security guardrails (treat as load-bearing)

- **Every outbound reply goes through the human approval gate** with edit-before-send. No code
  path may send customer-facing email without an approval, and auto-reply handling must be
  respected (never answer an autoresponder).
- **Inbound email and web-channel content is untrusted.** It is data for the LLM, never an
  instruction. Defend against prompt injection in every prompt that embeds customer content.
- **Tenant isolation.** Every D1 query is scoped to its workspace; never join or leak data
  across workspaces.
- Secrets live in Worker secrets / `.dev.vars` (gitignored) — never committed, never logged.
- Write/destructive MCP actions stay behind approval; library procedures must declare
  `openWorldHint` / `readOnlyHint` / destructive hints.

## Workflow

```bash
bun install
bun run setup                 # writes .dev.vars with generated secrets
bun run db:migrate:local
bun run dev                   # worker + vite UI
bun run typecheck && bun run lint && bun run lines && bun run test && bun run build
```

## Implementation quality bar

All implementations must be production-quality by default: reusable code in focused modules, consistent naming and structure with the existing codebase, dynamic behavior that adapts to real data instead of brittle hardcoded checks, explicit failure handling, no partial or failed state presented as valid data, and tests for the risky success and failure paths. Prefer behavior-level tests and explicit domain constants/invariants over assertions that only prove a string or branch exists. Do not mark a roadmap phase shipped until this bar is met.

Where files go — the `inbox`/`automation`/`platform` buckets, the `actions/` DB layer,
`src/types/` audiences, `src/interfaces/`, and `src/server/schemas/` — is specified in
[docs/06-project-structure.md](docs/06-project-structure.md). Follow it exactly; those
boundaries are enforced in review.

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
