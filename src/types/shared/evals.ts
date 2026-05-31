import type { EvalAnonymizationConfig, EvalCase, EvalRun, EvalResult, EvalRunDetail, ResolvedTicketEvalInput, ResolvedTicketEvalExpected, EvalAssertion, ProcedureEvalReport } from '../../interfaces/evals';
export type { EvalAnonymizationConfig, EvalCase, EvalRun, EvalResult, EvalRunDetail, ResolvedTicketEvalInput, ResolvedTicketEvalExpected, EvalAssertion, ProcedureEvalReport };
export type EvalCaseSource = 'resolved_ticket' | 'procedure_spec' | 'synthetic' | 'api';
export const EVAL_CASE_STATUSES = ['active', 'archived'] as const;
export type EvalCaseStatus = (typeof EVAL_CASE_STATUSES)[number];
export const EVAL_RUN_SOURCES = ['api', 'cli', 'ci', 'scheduled'] as const;
export type EvalRunSource = (typeof EVAL_RUN_SOURCES)[number];
export type EvalRunStatus = 'running' | 'passed' | 'failed';
export type EvalResultStatus = 'passed' | 'failed' | 'skipped';
