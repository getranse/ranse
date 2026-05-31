import type { VerifiedResolutionRow, HonestResolutionMetrics } from '../../interfaces/honest-resolution';
export type { VerifiedResolutionRow, HonestResolutionMetrics };
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
