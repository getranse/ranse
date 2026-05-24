// Honest Resolution metric — verified_resolution lifecycle. Rejection reasons
// are open-ended; new signals can be added without a migration since the column
// is TEXT. The set below is the closed list the service writes today.

export const VERIFIED_RESOLUTION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type VerifiedResolutionStatus = (typeof VERIFIED_RESOLUTION_STATUSES)[number];

export const VERIFIED_RESOLUTION_REJECTION_REASONS = [
  'human_takeover',
  'escalated',
  'follow_up',
  'negative_feedback',
  'reopened',
] as const;
export type VerifiedResolutionRejectionReason =
  (typeof VERIFIED_RESOLUTION_REJECTION_REASONS)[number];

export const VERIFIED_RESOLUTION_SOURCES = ['autonomous', 'procedure'] as const;
export type VerifiedResolutionSource = (typeof VERIFIED_RESOLUTION_SOURCES)[number];

export const VERIFICATION_WINDOW_DAYS = 7;
export const VERIFICATION_WINDOW_MS = VERIFICATION_WINDOW_DAYS * 24 * 60 * 60_000;

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
