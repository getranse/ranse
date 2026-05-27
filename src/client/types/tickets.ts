import type { AnswerInspectionHit, AnswerInspectionTrace } from './knowledge';

export interface TicketDraft {
  ok: boolean;
  subject?: string;
  body?: string;
  knowledge?: AnswerInspectionHit[];
  knowledgeTrace?: AnswerInspectionTrace;
  error?: string;
}

export interface DraftAssistResult {
  completion: string;
  confidence: number;
  knowledge: { id: string; title: string; url?: string; snippet?: string }[];
  similar: { id: string; subject: string; resolved_at: number | null; preview: string | null }[];
  model: string;
}
