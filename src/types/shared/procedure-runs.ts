// Run-lifecycle unions for procedure execution (see interfaces/procedures
// for the structural run/step interfaces).
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
