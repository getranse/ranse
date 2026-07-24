# Coding Standards

These are enforced automatically where possible (Biome, commitlint, the file-size check, CI) so
reviews focus on design, not formatting.

## File & function size

- **≤ 100 lines per file** — a hard rule for new files, enforced by `bun run lines`
  ([scripts/check-file-size.mjs](../scripts/check-file-size.mjs)) in CI.
- Legacy files over the limit are recorded in
  [scripts/file-size-baseline.json](../scripts/file-size-baseline.json) and **may only
  shrink**: a baseline file that grows fails CI, and once it drops to ≤ 100 lines it leaves
  the baseline permanently (`bun run lines:update`). When you touch a baseline file, leave it
  smaller than you found it.
- Functions stay small and single-purpose; prefer composition over long bodies.
- One primary export per file.

## TypeScript

- `strict: true`. No `any` (use `unknown` + narrowing); no non-null `!` without justification.
- Validate all external/boundary data (HTTP bodies, LLM structured output, event payloads,
  webhook payloads) with **zod** — every schema lives in `src/server/schemas/`, never inline.
- Shared types live in `src/types/{shared,server,client}`; every `interface` lives in
  `src/interfaces/<domain>.ts`. Never duplicate a type across surfaces. See
  [CLAUDE.md](../CLAUDE.md) for the full layout rules.

## Naming

- Modules and directories: **kebab-case** (`library-data.ts`, `email-draft.ts`).
- Durable Object / agent classes: **PascalCase** file named after the class
  (`WorkspaceSupervisorAgent.ts`, `MailboxAgent.ts`).
- Interface domain files: **plural** (`procedures.ts`, `tickets.ts`, `channels.ts`).
- Config: one file per domain under `src/config/` (`sla.ts`, `autonomy.ts`).
- Migrations: `YYYYMMDD_HHMMSS_<short_name>.sql` — see CLAUDE.md "Migrations".
- Branches: `type/short-description` (e.g. `feat/approval-gate-audit`).

## Style & lint

- **Biome** is the single source of truth for formatting and linting (`bun run lint`,
  auto-applied to staged files via lint-staged).
- No disabled rules without an inline reason comment.
- No `console.log` in committed server code — use structured logging so `wrangler tail` output
  stays parseable.

## Comments

- Match the density of the surrounding code. Explain **why**, not **what**.
- Public/core APIs get a short TSDoc block; security-relevant code gets a `// SECURITY:` note.
- Comments must not read as AI-generated: no narrating the next line, no restating the diff or
  prompt, no reviewer-directed notes ("added X to fix Y"), no filler ("Note that…", "It's
  important to…"). A comment speaks to the next reader of the code, not to whoever reviews the
  change that introduced it.

## Testing

- New logic ships with **Vitest** tests covering the risky success **and** failure paths.
- Prefer behavior-level tests and explicit domain constants/invariants over assertions that
  only prove a string or branch exists.
- Anything touching prompts, procedures, or specialists must keep `bun run test` and the
  procedure evals (`bun scripts/ranse.ts eval …`) green — the Evals workflow gates PRs.
- CI must be green (typecheck, lint, file-size, unit, build) before merge.

## Git & commits

- **[Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)**, enforced
  by commitlint. Format: `type(scope): subject`, imperative mood, ≤ 72 chars, no filler.
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
  - Scopes: see [commitlint.config.js](../commitlint.config.js) (`inbox`, `knowledge`,
    `procedures`, `mcp`, `evals`, `auth`, …).
  - Avoid vague or AI-sounding subjects (`improve code quality`, `update files`).
- **One feature/fix per commit**; keep commits focused and reviewable. Reference issues.
- **Authorship is the human contributor only.** Do **not** add Claude, Copilot, or any AI tool
  as a commit author or `Co-Authored-By`. No AI attribution trailers.
- PRs use the template, include a Changeset entry for user-facing changes, and link the issue.

## Accessibility & i18n

- The operator console is keyboard-navigable, screen-reader labeled, and respects
  reduced-motion.
- Customer-facing surfaces (web channels, hosted forms, email templates) must not hardcode
  copy deep in logic — keep strings collected so localization stays tractable.

## Performance budget

- The Worker stays within Cloudflare CPU-time limits: stream LLM output, push slow work onto
  Queues, never block a request on batch work.
- Client bundle stays lean — code-split heavy/optional console views.

## Open-source hygiene

- Apache-2.0 license headers are not required per-file; `LICENSE` is authoritative.
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, and `CODEOWNERS`
  are kept current.
- Changelog via **Changesets**; semver. No breaking change without a major bump + migration
  note.
