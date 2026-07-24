import type {
  VerifiedResolutionRejectionReason,
  VerifiedResolutionSource,
  VerifiedResolutionStatus,
} from '../types/shared/honest-resolution';

export interface VerifiedResolutionRow {
  id: string;
  workspace_id: string;
  ticket_id: string;
  ai_message_id: string;
  ai_authored_at: number;
  window_closes_at: number;
  status: VerifiedResolutionStatus;
  rejection_reason: VerifiedResolutionRejectionReason | null;
  verified_at: number | null;
  source: VerifiedResolutionSource;
  payload_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface HonestResolutionMetrics {
  windowDays: number;
  windowStart: number;
  windowEnd: number;
  // Total tickets in the window that had at least one AI-authored reply.
  aiAuthoredCount: number;
  verifiedCount: number;
  pendingCount: number;
  rejectedCount: number;
  rejectionBreakdown: Record<VerifiedResolutionRejectionReason, number>;
  // The Honest Resolution rate: verified / (verified + rejected + pending).
  // Pending counts against the denominator so a workspace cannot game the
  // rate by leaving everything pending; only confirmed verified counts.
  honestResolutionRate: number;
  // Industry-standard "Fin-style" rate: AI replied and no human took over,
  // regardless of follow-up or feedback. Surfacing both side by side is the
  // whole point of the metric.
  finStyleRate: number;
}
