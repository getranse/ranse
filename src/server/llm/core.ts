import { OpenAI } from 'openai';
import type { Env } from '../env';

/** Hardcoded AI Gateway name. Auto-provisioned in scripts/deploy.ts. */
export const GATEWAY_NAME = 'ranse';

import {
  MODELS_MASTER,
  type CallMetadata,
  type ModelSpec,
  type Provider,
  type RuntimeOverrides,
} from './config.types';

interface DispatchOptions {
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

export function parseModel(modelName: string): { provider: Provider; modelId: string; spec: ModelSpec } {
  const spec = MODELS_MASTER[modelName];
  if (!spec) throw new Error(`Unknown model: ${modelName}`);
  const sep = modelName.indexOf('/');
  if (sep < 0) throw new Error(`Malformed model name (missing provider prefix): ${modelName}`);
  return { provider: spec.provider, modelId: modelName.slice(sep + 1), spec };
}

function pickApiKey(provider: Provider, env: Env, overrides?: RuntimeOverrides): string | undefined {
  const userKey = overrides?.userApiKeys?.[provider];
  if (userKey) return userKey;
  switch (provider) {
    case 'openai': return env.OPENAI_API_KEY;
    case 'anthropic': return env.ANTHROPIC_API_KEY;
    case 'google-ai-studio': return env.GOOGLE_AI_STUDIO_API_KEY;
    case 'grok': return env.GROK_API_KEY;
    case 'openrouter': return env.OPENROUTER_API_KEY;
    // Workers AI through env.AI.gateway() returns a pre-authenticated URL —
    // the AI binding handles auth at the gateway. The OpenAI SDK still
    // requires a non-empty apiKey to construct the client, but the value
    // is decorative for this path. Falling through to a placeholder
    // means we don't fail when CLOUDFLARE_API_TOKEN is unset or lacks
    // Workers-AI permission.
    case 'workers-ai': return env.CLOUDFLARE_API_TOKEN || 'cf-binding-auth';
    case 'cerebras': return env.CEREBRAS_API_KEY;
  }
}

async function buildBaseUrl(
  provider: Provider,
  env: Env,
  spec: ModelSpec,
  overrides?: RuntimeOverrides,
): Promise<string> {
  if (overrides?.aiGateway) {
    return `${overrides.aiGateway.baseUrl.replace(/\/$/, '')}/${provider}`;
  }
  if (env.CLOUDFLARE_AI_GATEWAY_URL) {
    const u = new URL(env.CLOUDFLARE_AI_GATEWAY_URL);
    u.pathname = u.pathname.replace(/\/$/, '') + (spec.directOverride ? `/${provider}` : '/compat');
    return u.toString();
  }
  if (env.AI) {
    const gw = (env.AI as any).gateway(GATEWAY_NAME);
    return spec.directOverride
      ? await gw.getUrl(provider)
      : `${await gw.getUrl()}compat`;
  }
  return directProviderBaseUrl(provider);
}

function directProviderBaseUrl(provider: Provider): string {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'anthropic': return 'https://api.anthropic.com/v1';
    case 'google-ai-studio': return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'grok': return 'https://api.x.ai/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'workers-ai':
      throw new Error('Workers AI requires either the AI binding or the AI Gateway');
    case 'cerebras': return 'https://api.cerebras.ai/v1';
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
