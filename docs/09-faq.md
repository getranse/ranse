# FAQ

### Is Ranse an AI support tool or a shared inbox?

Both. The wedge is "shared inbox with first-class AI assist + approvals." You can turn the AI off entirely and use Ranse as a plain team inbox; you can also let AI draft every reply while requiring human approval.

### Which LLM providers are supported?

Out of the box: **Workers AI** (no setup), **OpenAI**, **Anthropic**, **Google AI Studio**, **Grok**, **OpenRouter**, and **Cerebras**. Add new ones by extending `src/llm/config.types.ts` `MODELS_MASTER`.

### Does it work without any paid API keys?

Yes. The default model is a Workers AI Llama model that runs on your Cloudflare account — no extra billing account required.

### Do I need to self-host on my own servers?

No — Ranse runs entirely on Cloudflare Workers, D1, R2, KV, Queues, and Durable Objects. There are no servers to manage.

### Can I run Ranse on my own domain?

Yes. Map a custom domain to the Worker in Cloudflare → Workers → your Worker → Domains. Update `APP_URL` accordingly. Support email addresses work independently via Email Routing.

### Does Ranse store the raw email?

Yes, in R2 under `raw/{workspaceId}/{mailboxId}/{messageId}.eml`. This preserves fidelity for audit, forensic analysis, and re-parsing if the parser improves.

### How are secrets handled during one-click deploy?

`wrangler.jsonc` declares empty-string `vars` that the Deploy-to-Cloudflare UI prompts for at build time. The `scripts/deploy.ts` orchestrator then promotes sensitive ones to Worker secrets via `wrangler secret bulk`. This matches the pattern Cloudflare's vibesdk uses.

### Can I contribute a new specialist agent?

Yes — add a file under `src/agents/specialists/`, export a Zod schema + runner function, wire it into the supervisor where it fits in the event flow. PRs welcome.

### What's the relationship between Ranse (OSS) and getranse.com (SaaS)?

`getranse.com` will be a hosted multi-tenant SaaS wrapper around this OSS. You can always self-host for free; the SaaS exists for teams that don't want to manage their own Cloudflare account.

### Why not use the Vercel AI SDK?

We considered it. vibesdk (which we mirror for deploy patterns) uses the OpenAI SDK directly against AI Gateway's `/compat` endpoint — one dependency, one dispatch path, every provider. The Vercel AI SDK adds weight we don't need for this use case. If you want streaming-UI-specific helpers, you can layer it on.
