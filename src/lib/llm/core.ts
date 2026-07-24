import type { DispatchOptions, ResolvedClient } from '../../interfaces/llm-runtime';
import { buildBaseUrl } from './base-url';

export type { ResolvedClient };

import { OpenAI } from 'openai';
import { GATEWAY_NAME } from '../../config/llm';
import { MODELS_MASTER } from '../../config/models';
import type { Env } from '../../server/env';

export { GATEWAY_NAME };

import type { ModelSpec, Provider, RuntimeOverrides } from '../../types/server/llm';

export function parseModel(modelName: string): {
  provider: Provider;
  modelId: string;
  spec: ModelSpec;
} {
  const spec = MODELS_MASTER[modelName];
  if (!spec) throw new Error(`Unknown model: ${modelName}`);
  const sep = modelName.indexOf('/');
  if (sep < 0) throw new Error(`Malformed model name (missing provider prefix): ${modelName}`);
  return { provider: spec.provider, modelId: modelName.slice(sep + 1), spec };
}

function pickApiKey(
  provider: Provider,
  env: Env,
  overrides?: RuntimeOverrides,
): string | undefined {
  const userKey = overrides?.userApiKeys?.[provider];
  if (userKey) return userKey;
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY;
    case 'google-ai-studio':
      return env.GOOGLE_AI_STUDIO_API_KEY;
    case 'grok':
      return env.GROK_API_KEY;
    case 'openrouter':
      return env.OPENROUTER_API_KEY;
    // Workers AI through env.AI.gateway() returns a pre-authenticated URL —
    // the AI binding handles auth at the gateway. The OpenAI SDK still
    // requires a non-empty apiKey to construct the client, but the value
    // is decorative for this path. Falling through to a placeholder
    // means we don't fail when CLOUDFLARE_API_TOKEN is unset or lacks
    // Workers-AI permission.
    case 'workers-ai':
      return env.CLOUDFLARE_API_TOKEN || 'cf-binding-auth';
    case 'cerebras':
      return env.CEREBRAS_API_KEY;
  }
}

export async function resolveClient(
  args: DispatchOptions & { modelName: string },
): Promise<ResolvedClient> {
  const { env, overrides, metadata, modelName } = args;
  const { provider, modelId, spec } = parseModel(modelName);
  const apiKey = pickApiKey(provider, env, overrides) ?? '';
  const baseURL = await buildBaseUrl(provider, env, spec, overrides);

  const gatewayHeaders: Record<string, string> = {
    'cf-aig-metadata': JSON.stringify({
      workspaceId: metadata.workspaceId,
      ticketId: metadata.ticketId,
      userId: metadata.userId,
      actionKey: metadata.actionKey,
    }),
  };
  const gwToken = overrides?.aiGateway?.token ?? env.CLOUDFLARE_AI_GATEWAY_TOKEN;
  if (gwToken) gatewayHeaders['cf-aig-authorization'] = `Bearer ${gwToken}`;

  const client = new OpenAI({ apiKey, baseURL, defaultHeaders: gatewayHeaders });
  return { client, modelId, spec, gatewayHeaders };
}
