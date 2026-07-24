import type { Env } from '../server/env';
import type { AutonomyPolicy } from '../types/shared/autonomy';
import type { KnowledgeHit } from '../types/shared/knowledge';
import type { SendThreadedReply } from '../types/shared/supervisor';

export interface MailboxState {
  mailboxId: string;
  address: string;
  displayName: string;
  lastIngestAt: number;
  ingestCount: number;
  autoReplyCount: number;
}

export interface ProcedureRunnerState {
  runId: string;
  workspaceId: string;
  lastEventAt: number;
}

export interface SecretRecord {
  provider: string;
  ciphertext: string;
  iv: string;
  updated_at: number;
}

export interface SecretsState {
  workspaceId: string;
  providers: string[];
}

export interface DraftAssistInput {
  draftText: string;
  cursor?: number;
}

export interface SimilarTicket {
  id: string;
  subject: string;
  resolved_at: number | null;
  preview: string | null;
}

export interface DraftAssistResult {
  completion: string;
  confidence: number;
  knowledge: KnowledgeHit[];
  similar: SimilarTicket[];
  model: string;
}

export interface BusinessHours {
  /** Working days as JS getUTCDay() values (0 = Sunday … 6 = Saturday). */
  days: number[];
  /** Opening hour 0–23 in the workspace's local time. */
  start_hour: number;
  /** Closing hour 1–24 in the workspace's local time (exclusive). */
  end_hour: number;
  /** Workspace UTC offset in minutes (e.g. -300 for New York in winter). */
  utc_offset_minutes: number;
}

export interface SLAPolicy {
  first_response_minutes: { normal: number; high: number; urgent: number };
  resolution_hours: { normal: number; high: number; urgent: number };
  business_hours_only: boolean;
  /** Calendar used when business_hours_only is set; DEFAULT_BUSINESS_HOURS otherwise. */
  business_hours?: BusinessHours;
}

export interface SLAStatus {
  first_response_due_at: number;
  resolution_due_at: number;
  first_response_breached: boolean;
  resolution_breached: boolean;
}

export interface MailboxAutonomy {
  policy: AutonomyPolicy;
  threshold: number;
  rolloutPercent: number;
}

export interface AutoSendCtx {
  env: Env;
  workspaceId: string;
  sendThreadedReply: SendThreadedReply;
}
