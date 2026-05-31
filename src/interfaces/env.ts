import type { Ai, D1Database, DurableObjectNamespace, KVNamespace, Queue, R2Bucket, SendEmail, Vectorize, WorkerVersionMetadata } from '@cloudflare/workers-types';
import type { WorkspaceSupervisorAgent } from '../server/inbox/agents/WorkspaceSupervisorAgent';
import type { MailboxAgent } from '../server/inbox/agents/MailboxAgent';
import type { UserSecretsStore } from '../server/inbox/agents/UserSecretsStore';
import type { ProcedureRunnerAgent } from '../server/inbox/agents/ProcedureRunnerAgent';

export interface Env {
  APP_NAME: string;
  APP_URL?: string;
  LLM_DEFAULT_MODEL: string;

  // Optional — only set if the user adds a custom AI Gateway URL in the
  // dashboard. When unset, the LLM dispatcher uses `env.AI.gateway(<name>)`
  // with the name from GATEWAY_NAME in src/llm/core.ts.
  CLOUDFLARE_AI_GATEWAY_URL?: string;

  // secrets (all optional at build time — populated by deploy script or local .dev.vars)
  COOKIE_SIGNING_KEY?: string;
  ADMIN_SETUP_TOKEN?: string;
  // Master key for at-rest secret encryption. HKDF-derived per workspace
  // before any AES-GCM operation, so the same KEK protects every workspace
  // without sharing a derived key across them.
  SECRET_ENCRYPTION_KEY?: string;
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
  KNOWLEDGE_INDEX?: Vectorize;
  DB: D1Database;
  BLOB: R2Bucket;
  CACHE: KVNamespace;
  EMAIL: SendEmail;
  ASYNC_JOBS: Queue;
  WEBHOOKS: Queue;
  ASSETS: Fetcher;
  CF_VERSION: WorkerVersionMetadata;
  RATE_LIMIT_INGEST: RateLimit;

  WorkspaceSupervisorAgent: DurableObjectNamespace<WorkspaceSupervisorAgent>;
  MailboxAgent: DurableObjectNamespace<MailboxAgent>;
  UserSecretsStore: DurableObjectNamespace<UserSecretsStore>;
  ProcedureRunnerAgent: DurableObjectNamespace<ProcedureRunnerAgent>;
}

export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
