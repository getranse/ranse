import type { ProcedureStep, ProcedureEventType, ProcedureTriggerType, ProcedureSourceKind, ProcedureLibraryCategory, ProcedureRunStatus, ProcedureStepRunStatus } from '../types/shared/procedure';
import type { DiagramNodeShape } from '../server/automation/procedures/diagram';
import type { SendThreadedReply } from '../types/shared/supervisor';

export interface DiagramNode {
  id: string;
  shape: DiagramNodeShape;
  label: string;
  sublabel?: string;
  stepType?: ProcedureStep['type'];
  approvalGate?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export interface ProcedureDiagram {
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface LayoutCtx {
  nextY: number;
  counter: { value: number };
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  minX: number;
  maxX: number;
}

export interface PushNodeInput {
  shape: DiagramNodeShape;
  label: string;
  sublabel?: string;
  stepType?: ProcedureStep['type'];
  approvalGate?: boolean;
  x?: number;
}

export interface CheckForUpdatesResult {
  slug: string;
  status: 'current' | 'update_available' | 'unknown';
  forked_version: string;
  current_version?: string;
  current_fingerprint?: string;
}

export interface ProcedureRunEvent {
  type: ProcedureEventType;
  payload?: Record<string, unknown>;
}

export interface ProcedureRunnerOptions {
  event?: ProcedureRunEvent;
  sendThreadedReply?: SendThreadedReply;
}

export interface ProcedureBundle {
  procedure: ProcedureListItem;
  version: ProcedureVersion;
  spec: ProcedureSpec;
}

export interface ProcedureTrigger {
  type: ProcedureTriggerType;
  category?: string;
  intent?: string;
}

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
  usage?: 'required' | 'optional';
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
  readiness?: ProcedureLibraryReadiness;
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

export interface ProcedureLibraryReadinessTool {
  server: string;
  tool: string;
  usage: 'required' | 'optional';
  status: 'ready' | 'missing_server' | 'server_disabled' | 'missing_tool';
  destructive: boolean;
  read_only: boolean;
}

export interface ProcedureLibraryReadiness {
  status: 'ready' | 'needs_setup';
  ready_tool_count: number;
  required_tool_count: number;
  tools: ProcedureLibraryReadinessTool[];
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
