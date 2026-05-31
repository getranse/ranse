import type { OpenAI } from 'openai';
import type { Env } from '../server/env';
import type { ModelSpec, AgentConfig, ReasoningEffort, Provider } from '../types/server/llm';
import type { z } from 'zod';
import type { ActionKey } from '../types/shared/llm';

export interface DispatchOptions {
  env: Env;
  overrides?: RuntimeOverrides;
  metadata: CallMetadata;
}

export interface ResolvedClient {
  client: OpenAI;
  /** model id without the `provider/` prefix */
  modelId: string;
  spec: ModelSpec;
  gatewayHeaders: Record<string, string>;
}

export interface InferParams<T extends z.ZodTypeAny = z.ZodTypeAny> {
  env: Env;
  action: ActionKey;
  system: string;
  user: string;
  schema?: T;
  schemaName?: string;
  metadata: Omit<CallMetadata, 'actionKey'>;
  overrides?: RuntimeOverrides;
  workspaceConfig?: Partial<AgentConfig>;
  maxAttempts?: number;
}

export interface InferResult<T = unknown> {
  data: T;
  model: string;
  attempts: number;
  fellBackTo?: string;
}

export interface ModelConfig {
  model: string;
  fallbackModel?: string;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxTokens?: number;
}

export interface RuntimeOverrides {
  userApiKeys?: Partial<Record<Provider, string>>;
  aiGateway?: { baseUrl: string; token: string };
}

export interface CallMetadata {
  workspaceId: string;
  ticketId?: string;
  userId?: string;
  actionKey: ActionKey;
}
