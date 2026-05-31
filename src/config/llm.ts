import type { AgentConfig, ModelConfig } from '../types/server/llm';

const DEFAULT_FAST = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_SMART = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  triage: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0 },
  summarize: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0.2 },
  draft: { model: DEFAULT_SMART, fallbackModel: 'anthropic/claude-sonnet-4-6', temperature: 0.4 },
  knowledge_query: { model: DEFAULT_FAST, temperature: 0 },
  knowledge_plan: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0 },
  knowledge_judge: {
    model: DEFAULT_SMART,
    fallbackModel: 'anthropic/claude-sonnet-4-6',
    temperature: 0,
  },
  knowledge_rewrite: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0.1 },
  escalation: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0 },
  conversational: { model: DEFAULT_SMART, temperature: 0.5 },
};

export function resolveDefault(action: keyof AgentConfig): ModelConfig {
  return DEFAULT_AGENT_CONFIG[action];
}

/** AI Gateway slug used for `https://gateway.ai.cloudflare.com/v1/<account>/<GATEWAY_NAME>/...`. */
export const GATEWAY_NAME = 'ranse';

/** External LLM providers that require an operator-set API key (BYOK).
 *  workers-ai is auth'd via the `env.AI` binding and isn't in this list.
 *  Keys are the provider slugs that appear in `MODELS_MASTER[name].provider`. */
export const BYOK_PROVIDERS = [
  'openai',
  'anthropic',
  'google-ai-studio',
  'grok',
  'openrouter',
  'cerebras',
] as const;

export type BYOKProvider = (typeof BYOK_PROVIDERS)[number];

/** Mapping from provider slug → env-secret name that holds the API key. */
export const PROVIDER_ENV_KEY: Record<BYOKProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  'google-ai-studio': 'GOOGLE_AI_STUDIO_API_KEY',
  grok: 'GROK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
};
