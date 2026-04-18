import type { Ai, D1Database, DurableObjectNamespace, KVNamespace, Queue, R2Bucket, SendEmail, WorkerVersionMetadata } from '@cloudflare/workers-types';

export interface Env {
  APP_NAME: string;
  APP_URL: string;
  ADMIN_EMAIL: string;
  SUPPORT_DOMAIN: string;
  LLM_DEFAULT_MODEL: string;

  // Optional — only set if the user adds a custom AI Gateway URL in the
  // dashboard. When unset, the LLM dispatcher uses `env.AI.gateway(<name>)`
  // with the name from GATEWAY_NAME in src/llm/core.ts.
  CLOUDFLARE_AI_GATEWAY_URL?: string;

  // secrets (all optional at build time — populated by deploy script or local .dev.vars)
  COOKIE_SIGNING_KEY?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  GROK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;

  // bindings
  AI: Ai;
  DB: D1Database;
  BLOB: R2Bucket;
  CACHE: KVNamespace;
  EMAIL: SendEmail;
  ASYNC_JOBS: Queue;
  WEBHOOKS: Queue;
  ASSETS: Fetcher;
  CF_VERSION: WorkerVersionMetadata;
  RATE_LIMIT_INGEST: RateLimit;

  WorkspaceSupervisorAgent: DurableObjectNamespace;
  MailboxAgent: DurableObjectNamespace;
  UserSecretsStore: DurableObjectNamespace;
}

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
