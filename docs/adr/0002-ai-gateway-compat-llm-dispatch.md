# ADR-0002: Single LLM dispatch through AI Gateway `/compat`

**Status:** Accepted

## Context

Ranse needs per-step model choice (a cheap model for triage, a strong one for drafting),
multiple providers (Workers AI default, BYOK Anthropic/OpenAI/Google/Grok/OpenRouter/Cerebras),
and observability over every call — without scattering provider SDKs through the codebase.

## Decision

Every LLM call goes through one dispatcher (`src/lib/llm/`) using the **OpenAI SDK against the
Cloudflare AI Gateway `/compat` endpoint**. Model and provider are configuration per agent
action (`src/config/llm.ts`, `workspace_llm_config`), not code.

## Consequences

- Switching providers is a one-line config change per action; per-step routing is free.
- AI Gateway gives caching, logging, and rate limiting at the gateway rather than in app code.
- Provider-specific features not exposed through the compat surface are off the table unless
  the dispatcher grows an explicit escape hatch.
- Workers AI as the default means a fresh deploy answers with zero API keys configured.
