import type { CustomerMemory, ExtractedFact } from '../../interfaces/memory';
export type { CustomerMemory, ExtractedFact };
// Long-term customer memory. Distilled facts the agent should remember
// about a customer across all their tickets — preferences, account
// context, prior complaints, dietary requirements, time zones, name
// pronunciation. Stored conservatively: every row links back to the
// ticket + message it was extracted from and carries a confidence score.

export type CustomerMemoryKind =
  | 'fact'
  | 'preference'
  | 'context'
  | 'complaint'
  | 'communication_style';
