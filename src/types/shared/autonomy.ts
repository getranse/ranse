import type { AutonomyScoreComponents, AutonomousDraftScore, AutonomyDecision, TicketOutcomeEvent, TicketFeedback, WorkspaceOutcomeDaily } from '../../interfaces/autonomy';
export type { AutonomyScoreComponents, AutonomousDraftScore, AutonomyDecision, TicketOutcomeEvent, TicketFeedback, WorkspaceOutcomeDaily };
export const AUTONOMY_POLICIES = [
  'draft_only',
  'auto_send_if_confident',
  'auto_send_always',
] as const;

export type AutonomyPolicy = (typeof AUTONOMY_POLICIES)[number];

export {
  DEFAULT_AUTONOMY_THRESHOLD,
  MIN_AUTONOMY_THRESHOLD,
  MAX_AUTONOMY_THRESHOLD,
  DEFAULT_AUTONOMY_ROLLOUT_PERCENT,
} from '../../config/autonomy';
import {
  DEFAULT_AUTONOMY_THRESHOLD,
  MIN_AUTONOMY_THRESHOLD,
  MAX_AUTONOMY_THRESHOLD,
  DEFAULT_AUTONOMY_ROLLOUT_PERCENT,
} from '../../config/autonomy';

export const OUTCOME_KINDS = [
  'resolved_autonomously',
  'resolved_via_procedure',
  'escalated',
  'customer_followed_up',
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];
export type OutcomeSource = 'agent' | 'procedure' | 'system' | 'user';
export const FEEDBACK_RATINGS = ['positive', 'negative'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
export type FeedbackSource = 'agent' | 'customer' | 'system';

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
