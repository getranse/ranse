# Contributing to Ranse

Thanks for your interest in Ranse! This project is early — the fastest way to contribute is to use it and file issues.

Please read [CLAUDE.md](CLAUDE.md) (contributor + AI-assistant notes) and the
[docs](docs/) before your first code contribution — especially
[Architecture](docs/01-architecture.md), [Security](docs/05-security.md), and
[Operations](docs/04-operations.md).

## Ground rules

- **One Worker repo.** Keep Ranse deployable as a single Cloudflare Worker app. Do not introduce monorepo tooling or split services without discussion — one-click deploy breaks.
- **Minimal dependencies.** Prefer Cloudflare-native primitives (DOs, D1, R2, KV, Queues, AI Gateway) over external services.
- **No `experimentalDecorators`.** The Agents SDK uses TC39 standard decorators — don't enable the legacy flag.
- **Security first.** Any code path touching outbound email must respect approval gates and auto-reply handling.
- **Production-quality implementation bar.** Every implementation must be reusable, locally consistent, dynamic enough to adapt to real data, and failure-safe: shared logic belongs in focused modules, state transitions must not expose partial/failed work as valid data, user-visible metrics must match what they claim to measure, and tests must cover the important success and failure paths. Avoid brittle hardcoded checks that only prove a string or branch exists; prefer behavior-level tests and explicit domain constants/invariants. A feature is not complete just because the happy path works.
- **Shared types live in `src/types/`.** Keep local-only helper types beside their implementation, but move cross-module DTOs/contracts into a domain file under `src/types/`.
- **≤ 100 lines per file** for new files, enforced by `bun run lines` in CI. Legacy files listed in `scripts/file-size-baseline.json` may only shrink (run `bun run lines:update` after slimming one). Split by responsibility before you hit the limit. See [docs/07-coding-standards.md](docs/07-coding-standards.md).

## Development

```bash
bun install
bun run setup
bun run db:migrate:local
bun run dev
```

## Pull requests

- Branch: `type/short-description` (e.g. `feat/approval-gate-audit`).
- Run `bun run typecheck && bun run lint && bun run lines && bun run test && bun run build` before opening a PR.
- Add a Changeset for user-facing changes: `bun run changeset`.
- Keep commits focused. One logical change per PR. Conventional Commits are enforced by
  commitlint via a husky `commit-msg` hook; staged files are auto-checked with Biome via
  lint-staged.
- **No AI authorship.** Do not add Claude, Copilot, or any AI assistant as a commit author or
  `Co-Authored-By` trailer. Commits are attributed to you, the human contributor.
- Use the PR template. Include a before/after description in the PR body if the change affects
  UX, APIs, or the setup flow.
- If your change touches auth, outbound email / approval gates, MCP actions, or tenant
  isolation, fill in the template's security-impact section with a short threat note.

## Procedure library contributions

- Start from `docs/04-operations.md`, `src/server/automation/procedures/library-data.ts`, and `src/server/automation/procedures/library-mcp-tools.ts`.
- Keep procedures generic enough for another company to fork. Do not bake customer-specific policy text, private route names, or proprietary tool names into shared library procedures.
- Every library procedure must include inline `evals`, a generic owner of `ranse-library`, deterministic provenance, and reference MCP tool specs for external system assumptions. Required MCP references must be exercised by `call_action` steps, and write/destructive actions must stay behind approval.
- Include MCP `openWorldHint`, `readOnlyHint`, and destructive/idempotent hints where applicable.
- Run `bun scripts/ranse.ts procedure validate-library`, `bun scripts/ranse.ts procedure add <slug> --dir /tmp/ranse-procs --force`, `bun scripts/ranse.ts eval /tmp/ranse-procs/<slug>.yaml`, and `bunx vitest run tests/procedure-library.test.ts`.

## Commit messages

Use terse Conventional Commit-style subjects:

```text
type(scope): short summary
```

Scope is optional. Keep the subject under 72 characters, use imperative mood, and do not add filler words. If the change needs context, put it in the commit body.

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `style`.

Good:

```text
feat(knowledge): add vectorized retrieval
fix(email): preserve reply threading headers
docs: document migration filenames
refactor(api): split route modules
```

Avoid vague or AI-sounding subjects like `improve code quality`, `implement comprehensive solution`, or `update files`.

## Reporting issues

Use GitHub issues. **Do not** open a public issue for vulnerabilities — follow
[SECURITY.md](SECURITY.md) (GitHub Security Advisories or `security@getranse.com`).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
