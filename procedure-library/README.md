# Ranse Procedure Library

The built-in library is the seed for the future `getranse/procedures-library` community repo. Each entry is forkable, ships with inline evals, and includes reference MCP tool specs for the systems it expects a workspace to expose.

## Install locally

```bash
bun scripts/ranse.ts procedure list
bun scripts/ranse.ts procedure add refund-intake --dir procedures
bun scripts/ranse.ts eval procedures/refund-intake.yaml
```

`procedure add` writes two files:

- `<slug>.yaml` — the procedure spec to customize, review, and commit.
- `<slug>.mcp.json` — reference MCP tool contracts to implement or map to existing servers.

## Current entries

| Slug | Category | MCP references |
|---|---|---|
| `refund-intake` | Billing | Stripe customer lookup and refund creation |
| `password-reset` | Account | Identity lookup and password reset request creation |
| `shipping-dispute` | Shipping | Shopify order search |
| `gdpr-data-request` | Privacy | Privacy request creation |

## Contribution bar

- Keep procedures generic enough for another company to fork.
- Include at least one eval case in `evals`.
- Include reference MCP tool specs for every external system assumption.
- Default risky actions to approval, and never ask customers for secrets, passwords, or one-time codes.
- Run `bun scripts/ranse.ts procedure add <slug> --dir /tmp/ranse-procs --force` and `bun run test` before opening a PR.
