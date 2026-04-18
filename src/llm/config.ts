import type { AgentConfig, ModelConfig } from './config.types';

const DEFAULT_FAST = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_SMART = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  triage: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0 },
  summarize: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0.2 },
  draft: { model: DEFAULT_SMART, fallbackModel: 'anthropic/claude-sonnet-4-6', temperature: 0.4 },
  knowledge_query: { model: DEFAULT_FAST, temperature: 0 },
  escalation: { model: DEFAULT_FAST, fallbackModel: 'openai/gpt-4o-mini', temperature: 0 },
  conversational: { model: DEFAULT_SMART, temperature: 0.5 },
};

export function resolveDefault(action: keyof AgentConfig): ModelConfig {
  return DEFAULT_AGENT_CONFIG[action];
}
