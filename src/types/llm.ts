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
