import type { AuditActorType } from '../types/shared/audit';
import type { FeedbackRating } from '../types/shared/autonomy';

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
}

export interface AuditInput {
  workspaceId: string;
  ticketId?: string;
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  payload?: Record<string, unknown>;
  context?: AuditContext;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  workspaceId?: string;
}

// Customer-facing decision trace: every AI-authored reply can carry an
// HMAC-signed "Why this answer?" link resolving to a sanitized page (cited KB
// sources, procedure + step, MCP tool labels — never payloads — confidence,
// approver, eval pass rate, knowledge freshness). Customers distrust AI they
// cannot inspect; exposing the trace is a trust unlock closed SaaS won't ship.

export interface DecisionTraceTokenPayload {
  workspaceId: string;
  ticketId: string;
  messageId: string;
  expiresAt: number;
}

export interface PublicTraceKbSource {
  title: string;
  url: string | null;
  last_refreshed_at: number | null;
}

export interface PublicTraceMcpCall {
  label: string;
  read_only: boolean;
  status: string;
  approved_by_human: boolean;
}

export interface PublicTrace {
  workspaceLabel: string;
  authoredAt: number;
  channel: string;
  kbSources: PublicTraceKbSource[];
  procedure: { name: string; version: string } | null;
  mcpCalls: PublicTraceMcpCall[];
  confidence: number | null;
  approver: string | null;
  evalPassRate: number | null;
  reasonSummary: string;
}

/**
 * Standard JSON error body shape used across all API routes:
 *   { error: <snake_case_code>, message: <human readable>, details?: ... }
 *
 * The UI API client picks up `message` and falls back to `error`.
 */
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface FeedbackTokenPayload {
  workspaceId: string;
  ticketId: string;
  messageId: string;
  rating: FeedbackRating;
  expiresAt: number;
}

export interface FeedbackLinks {
  positive: string;
  negative: string;
  /** Signed customer-portal link for the ticket, when APP_URL is configured. */
  portal?: string;
}

export interface UploadOptions {
  maxBytes: number;
  /** Form field the file is posted under. Defaults to "file". */
  field?: string;
  /** Return an error message to reject the file, or null to accept it. */
  validate?: (file: File) => string | null;
}

export interface UploadedFile {
  form: FormData;
  file: File;
  bytes: ArrayBuffer;
  contentType: string;
  ext: string;
}

export interface SealedBlob {
  v: number;
  iv: string;
  ct: string;
}
