export type EvalCaseSource = 'resolved_ticket' | 'procedure_spec' | 'synthetic' | 'api';
export type EvalCaseStatus = 'active' | 'archived';
export type EvalRunSource = 'api' | 'cli' | 'ci' | 'scheduled';
export type EvalRunStatus = 'running' | 'passed' | 'failed';
export type EvalResultStatus = 'passed' | 'failed' | 'skipped';

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
