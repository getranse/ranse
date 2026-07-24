import type { OpenAI } from 'openai';
import type { z } from 'zod';
import type { Env } from '../server/env';
import type { ModelSpec } from '../server/schemas/llm';
import type { ActionKey, AgentConfig } from '../types/shared/llm';
import type { CallMetadata, RuntimeOverrides } from './llm';

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
