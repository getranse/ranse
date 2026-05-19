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

export interface CustomerMemory {
  id: string;
  workspace_id: string;
  customer_id: string;
  kind: CustomerMemoryKind;
  fact_text: string;
  confidence: number;
  source_ticket_id: string | null;
  source_message_id: string | null;
  evidence_hash: string | null;
  created_by: 'extractor' | 'operator' | 'system';
  redacted_at: number | null;
  redacted_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface ExtractedFact {
  kind: CustomerMemoryKind;
  text: string;
  confidence: number;
}
