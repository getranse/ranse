# Contributing to Ranse

Thanks for your interest in Ranse! This project is early — the fastest way to contribute is to use it and file issues.

## Ground rules

- **One Worker repo.** Keep Ranse deployable as a single Cloudflare Worker app. Do not introduce monorepo tooling or split services without discussion — one-click deploy breaks.
- **Minimal dependencies.** Prefer Cloudflare-native primitives (DOs, D1, R2, KV, Queues, AI Gateway) over external services.
- **No `experimentalDecorators`.** The Agents SDK uses TC39 standard decorators — don't enable the legacy flag.
- **Security first.** Any code path touching outbound email must respect approval gates and auto-reply handling.
- **Production-quality implementation bar.** Every implementation must be reusable, locally consistent, dynamic enough to adapt to real data, and failure-safe: shared logic belongs in focused modules, state transitions must not expose partial/failed work as valid data, user-visible metrics must match what they claim to measure, and tests must cover the important success and failure paths. Avoid brittle hardcoded checks that only prove a string or branch exists; prefer behavior-level tests and explicit domain constants/invariants. A feature is not complete just because the happy path works.
- **Shared types live in `src/types/`.** Keep local-only helper types beside their implementation, but move cross-module DTOs/contracts into a domain file under `src/types/`.
- **Keep modules small.** Aim for 100–150 lines on average. Under 300 lines is the normal ceiling; files over 300 lines should be split by responsibility before more behavior is added.

## Development

```bash
bun install
bun run setup
bun run db:migrate:local
bun run dev
```

## Pull requests

- Run `bun run typecheck && bun run lint` before opening a PR.
- Keep commits focused. One logical change per PR.
- Include a before/after description in the PR body if the change affects UX, APIs, or the setup flow.

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

Use GitHub issues. For security-sensitive reports, email `security@getranse.com` instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
