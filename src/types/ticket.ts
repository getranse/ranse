import type { AgenticRetrievalTrace, KnowledgeHit } from './knowledge';

export interface TicketViewData {
  ticket: {
    id: string;
    subject: string;
    requester_email: string;
    priority: string;
    category?: string | null;
    status: string;
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
    status: string;
    proposed_json: string;
    risk_reasons_json: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    created_at: number;
  }>;
}

export interface ProposedReply {
  subject?: string;
  body_markdown?: string;
  cites_knowledge_ids?: string[];
  knowledge_hits?: KnowledgeHit[];
  knowledge_trace?: AgenticRetrievalTrace;
}

export interface ReplyEdits {
  subject: string;
  body_markdown: string;
}
