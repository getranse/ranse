import type { AuditCategory, AuditSeverity, AuditActorType } from '../types/shared/audit';

export interface AuditActionMeta {
  category: AuditCategory;
  severity: AuditSeverity;
}

export interface AuditEventRecord {
  id: string;
  ticket_id: string | null;
  actor_type: AuditActorType;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  payload_json: string;
  prev_hash: string | null;
  hash: string | null;
  created_at: number;
}

export interface AuditQuery {
  limit?: number;
  action?: string;
  category?: AuditCategory;
  actorId?: string;
  ticketId?: string;
  from?: number;
  to?: number;
}
