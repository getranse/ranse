# Ranse — contributor notes

## Implementation quality bar

All implementations must be production-quality by default: reusable code in focused modules, consistent naming and structure with the existing codebase, dynamic behavior that adapts to real data instead of brittle hardcoded checks, explicit failure handling, no partial or failed state presented as valid data, and tests for the risky success and failure paths. Prefer behavior-level tests and explicit domain constants/invariants over assertions that only prove a string or branch exists. Do not mark a roadmap phase shipped until this bar is met.

Shared contracts belong in `src/types/`, not scattered through feature modules. Keep local-only helper types near their implementation, but move any type used across agents, API routes, UI, or tests into a domain file under `src/types/`. Keep modules focused: 100–150 lines is the target average, under 300 lines is the normal ceiling. If a file grows past 300 lines, split it by responsibility before adding more behavior.

## Migrations

New migrations use a **timestamp prefix**, not a sequential counter:

```
YYYYMMDD_HHMMSS_<short_name>.sql
```

Example: `20260503_120000_notification_channels.sql`.

Why: `wrangler d1` sorts the `migrations/` directory alphabetically and applies anything not in the `d1_migrations` tracking table — it doesn't care about the format. Sequential numbering (`0004_`, `0005_`, ...) silently breaks when two contributors land migrations on parallel branches with the same number. Timestamps remove the collision.

Old migrations (`0001_init.sql` through `0005_notification_channels.sql`) stay as-is — `0` < `2` alphabetically, so old + new sort correctly together. **Don't rename applied migrations** — `wrangler` keys the tracking table on filename, so a rename re-runs the migration under the new name.

Create with `wrangler d1 migrations create ranse-db <name>`, then **rename the generated `0006_<name>.sql` to the timestamp form** before committing.
