import type { ProcedureCondition } from '../../interfaces/procedures';

// Structural procedure interfaces live in interfaces/procedures; this module
// re-exports them beside the shared unions so consumers import one path.
export type * from '../../interfaces/procedures';

import type { KnowledgeSearchScope } from './knowledge';

export type {
  ProcedureEventType,
  ProcedureRunStatus,
  ProcedureStepRunStatus,
} from './procedure-runs';

export const PROCEDURE_TRIGGER_TYPES = ['manual', 'ticket_created', 'intent'] as const;
export type ProcedureTriggerType = (typeof PROCEDURE_TRIGGER_TYPES)[number];
export const PROCEDURE_SOURCE_KINDS = ['api', 'git', 'seed'] as const;
export type ProcedureSourceKind = (typeof PROCEDURE_SOURCE_KINDS)[number];
export type ProcedureLibraryCategory =
  | 'billing'
  | 'account'
  | 'shipping'
  | 'privacy'
  | 'triage'
  | 'incident'
  | 'engineering'
  | 'product'
  | 'analytics'
  | 'docs'
  | 'admin';
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
