export const AUTONOMY_POLICIES = [
  'draft_only',
  'auto_send_if_confident',
  'auto_send_always',
] as const;

export type AutonomyPolicy = (typeof AUTONOMY_POLICIES)[number];

export const DEFAULT_AUTONOMY_THRESHOLD = 0.85;
export const MIN_AUTONOMY_THRESHOLD = 0.5;
export const MAX_AUTONOMY_THRESHOLD = 0.99;
export const DEFAULT_AUTONOMY_ROLLOUT_PERCENT = 100;

export interface AutonomyScoreComponents {
  draftConfidence: number;
  retrievalScore: number;
  groundedness: number;
  freshness: number;
}

export interface AutonomousDraftScore {
  score: number;
  components: AutonomyScoreComponents;
  riskReasons: string[];
  hardBlockReasons: string[];
}

export interface AutonomyDecision {
  action: 'create_approval' | 'auto_send';
  reason: string;
}

export const OUTCOME_KINDS = [
  'resolved_autonomously',
  'resolved_via_procedure',
  'escalated',
  'customer_followed_up',
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];
export type OutcomeSource = 'agent' | 'procedure' | 'system' | 'user';
export type FeedbackRating = 'positive' | 'negative';
export type FeedbackSource = 'agent' | 'customer' | 'system';

export interface TicketOutcomeEvent {
  id: string;
  workspace_id: string;
  ticket_id: string;
  kind: OutcomeKind;
  source: OutcomeSource;
  confidence_score: number | null;
  payload_json: string;
  created_at: number;
}

export interface TicketFeedback {
  id: string;
  workspace_id: string;
  ticket_id: string;
  message_id: string | null;
  rating: FeedbackRating;
  source: FeedbackSource;
  comment: string | null;
  created_at: number;
}

export interface WorkspaceOutcomeDaily {
  workspace_id: string;
  day: string;
  resolved_autonomously_count: number;
  resolved_via_procedure_count: number;
  escalated_count: number;
  customer_followed_up_count: number;
  positive_feedback_count: number;
  negative_feedback_count: number;
  updated_at: number;
}

export function normalizeAutonomyPolicy(value?: string | null): AutonomyPolicy {
  if (value === 'draft_only' || value === 'off') return 'draft_only';
  if (value === 'auto_send_if_confident' || value === 'safe') return 'auto_send_if_confident';
  if (value === 'auto_send_always' || value === 'always') return 'auto_send_always';
  return 'draft_only';
}

export function legacyAutoReplyPolicy(policy: AutonomyPolicy): 'off' | 'safe' | 'always' {
  if (policy === 'auto_send_always') return 'always';
  if (policy === 'auto_send_if_confident') return 'safe';
  return 'off';
}

export function normalizeAutonomyThreshold(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AUTONOMY_THRESHOLD;
  return Math.min(MAX_AUTONOMY_THRESHOLD, Math.max(MIN_AUTONOMY_THRESHOLD, value));
}

export function normalizeAutonomyRolloutPercent(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AUTONOMY_ROLLOUT_PERCENT;
  return Math.min(100, Math.max(0, Math.round(value)));
}
