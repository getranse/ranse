import { GATEWAY_NAME } from '../../config/llm';
import type { RuntimeOverrides } from '../../interfaces/llm';
import type { Env } from '../../server/env';
import type { ModelSpec } from '../../server/schemas/llm';
import type { Provider } from '../../types/shared/llm';

export async function buildBaseUrl(
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
    return spec.directOverride ? await gw.getUrl(provider) : `${await gw.getUrl()}compat`;
  }
  return directProviderBaseUrl(provider);
}

function directProviderBaseUrl(provider: Provider): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'google-ai-studio':
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'grok':
      return 'https://api.x.ai/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'workers-ai':
      throw new Error('Workers AI requires either the AI binding or the AI Gateway');
    case 'cerebras':
      return 'https://api.cerebras.ai/v1';
  }
}
