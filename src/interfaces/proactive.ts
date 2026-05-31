import type { ProactiveProposalStatus, ProactiveProposalKind } from '../types/shared/proactive';

export interface ProactiveProposal {
  id: string;
  workspace_id: string;
  cluster_key: string;
  kind: ProactiveProposalKind;
  draft_procedure_spec_json: string | null;
  draft_knowledge_entry_json: string | null;
  eval_pass_rate: number | null;
  eval_case_count: number;
  eval_run_id: string | null;
  status: ProactiveProposalStatus;
  rejected_reason: string | null;
  proposed_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  applied_procedure_id: string | null;
  applied_knowledge_source_id: string | null;
  summary: string | null;
  evidence_ticket_ids_json: string | null;
}

export interface ProactiveProposalDraft {
  procedure?: {
    slug: string;
    name: string;
    version: string;
    description?: string;
    trigger: { type: string; intent?: string };
    steps: any[];
  };
  knowledge?: {
    title: string;
    body_markdown: string;
  };
  summary: string;
  evidenceTicketIds: string[];
}
