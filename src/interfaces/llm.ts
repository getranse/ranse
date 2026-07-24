import type { ActionKey, Provider, ReasoningEffort } from '../types/shared/llm';

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
