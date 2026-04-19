# Ranse

**The Cloudflare-native shared inbox for support teams.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/getranse/ranse)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Ranse turns support email into a real-time, multi-agent support workspace built on Cloudflare Workers, Durable Objects, Email Service, R2, D1, Queues, and AI Gateway.

---

## Why Ranse

- **Email-native shared inbox** with ticketing, assignment, and internal notes.
- **Multi-agent assist** — triage, summarization, knowledge retrieval, reply drafting, escalation, SLA.
- **Human approval gates** for every outbound reply, with edit-before-send.
- **Multi-provider LLM** — Workers AI out of the box; drop-in Anthropic, OpenAI, Google, Grok, OpenRouter via AI Gateway.
- **One-click deploy** to your own Cloudflare account — customer-owned from day one.
- **Open source** (Apache-2.0).

## Quick start

1. Click **Deploy to Cloudflare** above. Cloudflare forks the repo into your GitHub, provisions a Worker + D1 + R2 + KV + Queues + Durable Objects, and kicks off a build.
2. During the deploy-button flow, fill in the prompted variables:
   - `APP_URL` — your Worker URL (fill in after first deploy if unknown)
   - `ADMIN_EMAIL` — your admin account email
   - `SUPPORT_DOMAIN` — the domain you'll use for support email (e.g. `support.acme.com`)
3. Open your Worker URL — Ranse redirects you to `/setup`.
4. Enter the generated `ADMIN_SETUP_TOKEN` (see your Worker's secrets) to create the first admin + workspace.
5. Add your support mailbox in step 2 of the wizard.
6. In the **Cloudflare dashboard → Email → Email Routing**, route `support@yourdomain.com` to the Ranse Worker.
7. Send a test email — it lands in your inbox as a ticket with a triage summary and a suggested reply waiting for approval.

## Architecture, in one picture

```
Inbound email
   │
   ▼
 Worker  email()                ┌──────────────────────────────────────────┐
   │  parseInbound (postal-mime)│ WorkspaceSupervisorAgent (Durable Object)│
   │  resolveMailbox (D1)       │  ├─ ingestEmail()                        │
   │  putRaw → R2               │  │  └─ schedule(triageAndDraft)          │
   └──▶ Supervisor.ingestEmail──┤  ├─ triage → specialists/triage          │
                                │  ├─ search → specialists/knowledge       │
                                │  ├─ draft → specialists/draft            │
                                │  └─ createApproval → D1                  │
                                └──────────────────────────────────────────┘
                                              │
                                              ▼
                                  Operator console (React)
                                  Approve → Supervisor.approveAndSend
                                                 │
                                                 ▼
                                             env.EMAIL.send
```

All LLM calls go through a single dispatcher (`src/llm/`) that uses the OpenAI SDK and the Cloudflare AI Gateway `/compat` endpoint, so switching providers is a one-line config change per agent action.

## Docs

- [Installation](docs/installation.md) — detailed setup, troubleshooting, DNS.
- [Architecture](docs/architecture.md) — agents, storage model, event flow.
- [Operations](docs/operations.md) — ticket lifecycle, approvals, escalations.
- [Security](docs/security.md) — auth, roles, reply signing, auto-reply handling.
- [FAQ](docs/faq.md)

## Local development

```bash
bun install
bun run setup                 # writes .dev.vars with generated secrets
bun run db:migrate:local
bun run dev
```

Then open http://localhost:5173 (or http://localhost:8787 for the Worker directly).

> **Note:** Local email testing requires a Cloudflare Email Routing setup on a real domain. For local work you can `POST /setup/bootstrap` + seed test data manually, or write integration tests that call `Supervisor.ingestEmail` with a mock payload.

## Roadmap

**Phase 0 — Bootstrap** (this release): repo, one-click deploy, setup wizard, inbound email, supervisor DO, triage + draft + approvals.

**Phase 1 — Inbox core:** rich email rendering, attachment viewer, thread collapsing, saved views, search.

**Phase 2 — Agent assist:** vector-based knowledge search, macro library, tool use, per-workspace prompt tuning.

**Phase 3 — Reliability:** SLA timers, escalations, outbound webhooks, workflows for long jobs, exports.

**Phase 4 — Ecosystem:** MCP integrations, packaged integrations (Slack, Linear, Zendesk import), hosted SaaS wrapper on getranse.com.

## License

Apache-2.0 — see [LICENSE](LICENSE).

---

Built on [Cloudflare Workers](https://workers.cloudflare.com) + [Agents SDK](https://github.com/cloudflare/agents) + [Hono](https://hono.dev) + React 19. Inspired by [vibesdk](https://github.com/cloudflare/vibesdk)'s deploy pattern.
