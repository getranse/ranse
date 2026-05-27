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
