import type {
  FeedbackRating,
  FeedbackSource,
  OutcomeKind,
  OutcomeSource,
} from '../types/shared/autonomy';

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
