# Contributing to Ranse

Thanks for your interest in Ranse! This project is early — the fastest way to contribute is to use it and file issues.

## Ground rules

- **One Worker repo.** Keep Ranse deployable as a single Cloudflare Worker app. Do not introduce monorepo tooling or split services without discussion — one-click deploy breaks.
- **Minimal dependencies.** Prefer Cloudflare-native primitives (DOs, D1, R2, KV, Queues, AI Gateway) over external services.
- **No `experimentalDecorators`.** The Agents SDK uses TC39 standard decorators — don't enable the legacy flag.
- **Security first.** Any code path touching outbound email must respect approval gates and auto-reply handling.

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

## Reporting issues

Use GitHub issues. For security-sensitive reports, email `security@getranse.com` instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
