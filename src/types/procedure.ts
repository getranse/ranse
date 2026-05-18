import type { KnowledgeSearchScope } from './knowledge';

export type ProcedureTriggerType = 'manual' | 'ticket_created' | 'intent';
export type ProcedureSourceKind = 'api' | 'git' | 'seed';
export type ProcedureLibraryCategory = 'billing' | 'account' | 'shipping' | 'privacy' | 'triage';
export type ProcedureRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type ProcedureStepRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'skipped';
export type ProcedureEventType =
  | 'customer_reply'
  | 'approval_decided'
  | 'manual_resume'
  | 'timeout';

export interface ProcedureTrigger {
  type: ProcedureTriggerType;
  category?: string;
  intent?: string;
}

export type ProcedureStep =
  | {
      id: string;
      type: 'search';
      query: string;
      scope?: KnowledgeSearchScope;
      max_hops?: number;
      save_as?: string;
    }
  | { id: string; type: 'add_note'; body: string }
  | { id: string; type: 'ask_customer'; message: string; subject?: string }
  | {
      id: string;
      type: 'set_ticket_field';
      field: 'status' | 'priority' | 'category';
      value: string;
    }
  | {
      id: string;
      type: 'escalate_to';
      route_to: string;
      severity?: 'low' | 'normal' | 'high' | 'urgent';
      reason?: string;
    }
  | {
      id: string;
      type: 'wait_for_event';
      event: 'customer_reply' | 'approval_decided';
      timeout_ms?: number;
    }
  | {
      id: string;
      type: 'call_action';
      tool: string;
      args?: Record<string, unknown>;
      requires_approval?: boolean;
      save_as?: string;
    }
  | {
      id: string;
      type: 'if';
      condition: ProcedureCondition;
      then: ProcedureStep[];
      else?: ProcedureStep[];
    }
  | {
      id: string;
      type: 'loop';
      each: string;
      as?: string;
      max_iterations?: number;
      steps: ProcedureStep[];
    };

export interface ProcedureCondition {
  var: string;
  exists?: boolean;
  equals?: unknown;
  not_equals?: unknown;
}

export interface ProcedureSpec {
  slug: string;
  name: string;
  version: string;
  description?: string;
  owner?: string;
  trigger: ProcedureTrigger;
  steps: ProcedureStep[];
  evals?: Array<{ name: string; input: Record<string, unknown>; expect?: Record<string, unknown> }>;
}

export interface ProcedureLibraryMcpToolSpec {
  server: string;
  tool: string;
  title: string;
  description: string;
  input_schema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface ProcedureLibraryStandards {
  procedure_schema: 'ranse.procedure.v1';
  mcp_schema: '2025-11-25';
}

export interface ProcedureLibraryProvenance {
  source: 'ranse-library';
  source_ref: string;
  library_version: string;
  spec_checksum_algorithm: 'sha256';
  spec_checksum: string;
  standards: ProcedureLibraryStandards;
}

export interface ProcedureLibraryEntry {
  slug: string;
  name: string;
  summary: string;
  category: ProcedureLibraryCategory;
  tags: string[];
  risk_level: 'low' | 'medium' | 'high';
  required_mcp_servers: string[];
  eval_count: number;
  version: string;
  provenance: ProcedureLibraryProvenance;
}

export interface ProcedureLibraryItem extends ProcedureLibraryEntry {
  spec: ProcedureSpec;
  reference_mcp_tools: ProcedureLibraryMcpToolSpec[];
}

export interface ProcedureLibraryManifest {
  manifest_version: string;
  standards: ProcedureLibraryStandards;
  procedures: ProcedureLibraryItem[];
}

export interface ProcedureListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  trigger_type?: ProcedureTriggerType | null;
  trigger_category?: string | null;
  trigger_intent?: string | null;
  active_version_id: string | null;
  active_version: string | null;
  updated_at: number;
}

export interface ProcedureVersion {
  id: string;
  workspace_id: string;
  procedure_id: string;
  version: string;
  spec_json: string;
  source_kind: ProcedureSourceKind;
  source_ref: string | null;
  checksum: string;
  created_by_user_id: string | null;
  created_at: number;
}

export interface ProcedureRun {
  id: string;
  workspace_id: string;
  procedure_id: string;
  version_id: string;
  ticket_id: string;
  trigger_event_key: string | null;
  status: ProcedureRunStatus;
  current_step: number;
  context_json: string;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProcedureStepRun {
  id: string;
  workspace_id: string;
  run_id: string;
  step_id: string;
  step_index: number;
  status: ProcedureStepRunStatus;
  input_json: string;
  output_json: string;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
}

export interface ProcedureRunDetail {
  run: ProcedureRun;
  steps: ProcedureStepRun[];
  procedure?: ProcedureListItem;
}

export interface ProcedureSimulationStep {
  step_id: string;
  step_index: number;
  type: ProcedureStep['type'];
  status: ProcedureStepRunStatus;
  input: unknown;
  output: unknown;
  error?: string;
}

export interface ProcedureSimulationResult {
  procedure: {
    slug: string;
    name: string;
    version: string;
  };
  status: Extract<ProcedureRunStatus, 'completed' | 'waiting' | 'failed'>;
  steps: ProcedureSimulationStep[];
  context: Record<string, unknown>;
  error?: string;
}
