# Security Policy

Ranse handles customer email, LLM provider keys, and can send email on a team's behalf. It is
deployed to the customer's own Cloudflare account — **there is no Ranse-hosted backend**, so
your data and secrets never transit our infrastructure. The threat model and controls live in
[docs/security.md](docs/security.md).

## Supported versions

During pre-1.0 development, only the latest `main` is supported. After 1.0, the latest minor
release receives security fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

- Use **GitHub Security Advisories** ("Report a vulnerability") on this repository, or
- Email **security@getranse.com** with details and reproduction steps.

We aim to acknowledge within **72 hours** and to provide a remediation timeline after triage.
Coordinated disclosure is appreciated; we'll credit reporters who wish to be named.

## What to report

- Approval-gate bypasses: any path that sends outbound email without human approval, or that
  lets an autoresponder loop trigger replies.
- Prompt-injection escalations: crafted inbound email or web-channel content that triggers
  actions, exfiltrates data, or poisons the knowledge base.
- Tenant-isolation flaws: any read or write that crosses workspace boundaries.
- Auth/session weaknesses, privilege escalation across roles, or setup-token abuse.
- Secret exposure: provider keys or Worker secrets reaching logs, responses, or the client.
- MCP action-surface flaws: write/destructive tools reachable without approval, or SSRF via
  tool endpoints and web channels.

## Our commitments

- Customer-owned deployment; least-privilege bindings; secrets only in Worker secrets.
- Every outbound reply behind a human approval gate with edit-before-send.
- Dependencies pinned via lockfile and scanned (Dependabot, CI) before release.
- Security-relevant changes get extra review and a threat note in the PR.
