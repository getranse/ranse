import type { DraftResult } from '../server/inbox/agents/specialists/draft';
import type { AgentConfig } from '../types/server/llm';
import type { AgenticKnowledgeResult, KnowledgeHit } from '../types/shared/knowledge';
import type { EvalCaseSource, EvalCaseStatus, EvalRunSource, EvalRunStatus, EvalResultStatus } from '../types/shared/evals';

export interface AnonymizerState {
  emailMap: Map<string, string>;
  phoneMap: Map<string, string>;
  nameCount: number;
}

export interface AnonymizationMetadata {
  rules: {
    redactEmails: boolean;
    redactPhones: boolean;
    redactRequesterName: boolean;
  };
  counts: {
    emails: number;
    phones: number;
    requesterNames: number;
  };
}

export interface ResidualPiiFinding {
  kind: 'email' | 'phone' | 'requester_name';
  value: string;
}

export interface TicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  requester_email: string;
  requester_name: string | null;
}

export interface MessageRow {
  id: string;
  direction: string;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  preview: string | null;
  body_r2_key: string | null;
  sent_at: number;
}

export interface OutcomeRow {
  kind: string;
}

export interface RunEvalSuiteOptions {
  source?: 'api' | 'cli' | 'ci' | 'scheduled';
  limit?: number;
  caseIds?: string[];
  threshold?: number;
  scoreDropThreshold?: number;
  workspaceConfig?: Partial<AgentConfig>;
  retrievalRunner?: (input: ResolvedTicketEvalInput) => Promise<AgenticKnowledgeResult>;
  draftRunner?: (input: ResolvedTicketEvalInput, knowledge: KnowledgeHit[]) => Promise<DraftResult>;
}

export interface EvalAnonymizationConfig {
  redactEmails?: boolean;
  redactPhones?: boolean;
  redactRequesterName?: boolean;
  requesterEmail?: string | null;
  requesterName?: string | null;
}

export interface EvalCase {
  id: string;
  workspace_id: string;
  source: EvalCaseSource;
  ticket_id: string | null;
  procedure_id: string | null;
  procedure_version_id: string | null;
  name: string;
  status: EvalCaseStatus;
  input_json: string;
  expected_json: string;
  anonymization_json: string;
  source_fingerprint: string;
  captured_at: number;
  updated_at: number;
}

export interface EvalRun {
  id: string;
  workspace_id: string;
  source: EvalRunSource;
  status: EvalRunStatus;
  case_count: number;
  passed_count: number;
  failed_count: number;
  regression_count: number;
  config_json: string;
  started_at: number;
  completed_at: number | null;
  created_at: number;
}

export interface EvalResult {
  id: string;
  workspace_id: string;
  run_id: string;
  case_id: string;
  status: EvalResultStatus;
  score: number | null;
  assertions_json: string;
  actual_json: string;
  error: string | null;
  created_at: number;
}

export interface EvalRunDetail {
  run: EvalRun;
  results: Array<EvalResult & { case_name?: string; case_source?: EvalCaseSource }>;
}

export interface ResolvedTicketEvalInput {
  ticket: {
    id: string;
    subject: string;
    requester_email: string;
    requester_name: string | null;
    status: string;
    priority: string;
    category: string | null;
  };
  transcript: Array<{
    id: string;
    direction: string;
    from_address: string | null;
    to_address: string | null;
    subject: string | null;
    preview: string;
    sent_at: number;
  }>;
  latest_customer_message: {
    subject: string;
    preview: string;
  };
}

export interface ResolvedTicketEvalExpected {
  expected_status: string;
  expected_priority: string;
  expected_category: string | null;
  expected_reply_preview: string;
  required_terms: string[];
  outcome_kinds: string[];
}

export interface EvalAssertion {
  name: string;
  passed: boolean;
  message?: string;
  score?: number;
}

export interface ProcedureEvalReport {
  name: string;
  status: 'passed' | 'failed';
  assertions: EvalAssertion[];
  actual: unknown;
}
