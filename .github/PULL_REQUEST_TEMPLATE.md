<!-- Thanks for contributing to Ranse! Keep PRs focused: one feature/fix. -->

## What & why

<!-- Describe the change and link the issue: Closes #123 -->

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [ ] `bun run typecheck && bun run lint && bun run lines && bun run test && bun run build` pass locally
- [ ] No new file exceeds 100 lines; touched baseline files got smaller, not bigger
- [ ] Added a Changeset (`bun run changeset`) if user-facing
- [ ] Tests cover the risky success **and** failure paths (behavior-level, not string checks)
- [ ] DB queries live in `src/server/actions/`, zod schemas in `src/server/schemas/`,
      interfaces in `src/interfaces/`, shared types in `src/types/`
- [ ] New migrations use the `YYYYMMDD_HHMMSS_<name>.sql` timestamp form
- [ ] No AI tool added as commit author / `Co-Authored-By`
- [ ] No secrets committed or logged; workspace scoping preserved on every query

## Security impact

<!-- If this touches auth, outbound email / approval gates, MCP actions, web channels,
     or tenant isolation, describe the threat considerations. Otherwise write "none". -->
