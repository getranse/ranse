# Ranse Procedure Library

The built-in library is the seed for the future `getranse/procedures-library` community repo. Each entry is forkable, ships with inline evals, and includes reference MCP tool specs for the systems it expects a workspace to expose. Library validation ties those contracts back to real `call_action` steps so templates cannot advertise unused or unsafe external actions.

## Install locally

```bash
bun scripts/ranse.ts procedure list
bun scripts/ranse.ts procedure manifest
bun scripts/ranse.ts procedure validate-library
bun scripts/ranse.ts procedure add refund-intake --dir procedures
bun scripts/ranse.ts eval procedures/refund-intake.yaml
```

`procedure add` writes three files:

- `<slug>.yaml` or `<slug>.json` — the procedure spec to customize, review, and commit.
- `<slug>.mcp.json` — reference MCP tool contracts to implement or map to existing servers, including MCP ToolAnnotations.
- `<slug>.provenance.json` — immutable library version, source ref, procedure checksum, and standards metadata.

`procedure manifest` emits the full machine-readable catalog for mirroring into a standalone community repo. `procedure validate-library` reruns schema checks, inline evals, checksum generation, MCP annotation checks, action-reference matching, and approval-safety checks for write/destructive tools.

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
- Include reference MCP tool specs for every external system assumption, and exercise each required tool from a `call_action` step.
- Include `openWorldHint`, `readOnlyHint`, and destructive/idempotent hints where applicable.
- Default write and destructive actions to approval, and never ask customers for secrets, passwords, or one-time codes.
- Run `bun scripts/ranse.ts procedure validate-library`, `bun scripts/ranse.ts procedure add <slug> --dir /tmp/ranse-procs --force`, and `bun run test` before opening a PR.
