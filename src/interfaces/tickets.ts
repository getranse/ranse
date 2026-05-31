import type { AnswerInspectionHit, AnswerInspectionTrace } from '../types/client/knowledge';
import type { AgenticRetrievalTrace, KnowledgeHit } from '../types/shared/knowledge';
import type { TicketFeedback, TicketOutcomeEvent } from '../types/shared/autonomy';
import type { McpToolCall } from '../types/shared/mcp';
import type { ProcedureRun } from '../types/shared/procedure';

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

export interface TicketViewData {
  ticket: {
    id: string;
    subject: string;
    requester_email: string;
    requester_name?: string | null;
    priority: string;
    category?: string | null;
    status: string;
    customer_id?: string | null;
    ai_drafts_enabled?: number | null;
  };
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound' | 'note';
    from_address?: string | null;
    to_address?: string | null;
    preview?: string | null;
    sent_at: number;
  }>;
  approvals: Array<{
    id: string;
    kind: string;
    status: string;
    proposed_json: string;
    risk_reasons_json: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    created_at: number;
  }>;
  outcomes?: TicketOutcomeEvent[];
  feedback?: TicketFeedback[];
  procedureRuns?: ProcedureRun[];
  mcpToolCalls?: McpToolCall[];
}

export interface ProposedReply {
  subject?: string;
  body_markdown?: string;
  source_message_id?: string;
  cites_knowledge_ids?: string[];
  knowledge_hits?: KnowledgeHit[];
  knowledge_trace?: AgenticRetrievalTrace;
}

export interface ReplyEdits {
  subject: string;
  body_markdown: string;
}
