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

// Customer-facing decision trace. Every AI-authored outbound reply can carry
// a "Why this answer?" link signed with HMAC. The link resolves to a sanitized
// page that shows: KB sources cited, procedure + step, MCP tools called
// (label-only, never payloads), confidence, approver, eval pass rate of the
// procedure version, and last-knowledge-refresh timestamps.
//
// The point: industry CSAT collapses because customers cannot see why the AI
// said what it said. We have all the trace already in audit/message_index/
// procedure_run/mcp_tool_call — exposing it externally is a trust unlock no
// closed-SaaS competitor will ship because their first job is to hide it.

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
