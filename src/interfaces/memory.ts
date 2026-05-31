import type { CustomerMemoryKind } from '../types/shared/memory';

export interface TranscriptMessage {
  direction: 'inbound' | 'outbound' | 'note';
  fromAddress: string | null;
  sentAt: number;
  body: string;
}

// DB helpers for the customer_memory table. Reads always filter out
// redacted rows; writes dedupe on (workspace, customer, evidence_hash) so
// the extractor can re-run on the same conversation without doubling up.

export interface UpsertMemoryInput {
  workspaceId: string;
  customerId: string;
  kind: CustomerMemoryKind;
  factText: string;
  confidence: number;
  sourceTicketId?: string | null;
  sourceMessageId?: string | null;
  createdBy?: 'extractor' | 'operator' | 'system';
}

export interface CustomerMemoryEntry {
  id: string;
  customer_id: string;
  kind: string;
  fact_text: string;
  confidence: number;
  source_ticket_id: string | null;
  created_by: string;
  redacted_at: number | null;
  created_at: number;
  updated_at: number;
}

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
