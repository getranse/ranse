export const ACTION_KEYS = [
  'triage',
  'summarize',
  'draft',
  'knowledge_query',
  'knowledge_plan',
  'knowledge_judge',
  'knowledge_rewrite',
  'escalation',
  'conversational',
] as const;

export type ActionKey = (typeof ACTION_KEYS)[number];

export const PROVIDERS = [
  'workers-ai',
  'openai',
  'anthropic',
  'google-ai-studio',
  'grok',
  'openrouter',
  'cerebras',
] as const;

export type Provider = (typeof PROVIDERS)[number];

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type AgentConfig = Record<ActionKey, import('../../interfaces/llm').ModelConfig>;
