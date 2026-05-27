// Central audit-action catalog. Every audited action maps to a category (for
// filtering) and a severity (for triage). audit() derives these at write time
// and denormalizes them onto the row. Unknown actions fall back to general/info.

export type AuditCategory =
  | 'auth'
  | 'data'
  | 'admin'
  | 'security'
  | 'billing'
  | 'channel'
  | 'knowledge'
  | 'procedure'
  | 'notification'
  | 'general';

export type AuditSeverity = 'info' | 'notice' | 'warning' | 'critical';
export type AuditActorType = 'user' | 'agent' | 'system';

export interface AuditActionMeta {
  category: AuditCategory;
  severity: AuditSeverity;
}

export const AUDIT_ACTIONS = {
  // auth & sessions
  'auth.login': { category: 'auth', severity: 'notice' },
  'auth.login_failed': { category: 'security', severity: 'warning' },
  'auth.logout': { category: 'auth', severity: 'info' },
  'auth.password_changed': { category: 'security', severity: 'warning' },
  'auth.session_revoked': { category: 'security', severity: 'notice' },
  // workspace administration
  'workspace.created': { category: 'admin', severity: 'notice' },
  'workspace.updated': { category: 'admin', severity: 'notice' },
  'workspace.settings_changed': { category: 'admin', severity: 'notice' },
  'workspace.archived': { category: 'admin', severity: 'critical' },
  'workspace.deleted': { category: 'admin', severity: 'critical' },
  'workspace.exported': { category: 'admin', severity: 'critical' },
  'workspace.ownership_transferred': { category: 'admin', severity: 'critical' },
  'workspace.member_role_changed': { category: 'admin', severity: 'warning' },
  'workspace.member_removed': { category: 'admin', severity: 'warning' },
  'workspace.invitation_created': { category: 'admin', severity: 'notice' },
  'workspace.invitation_accepted': { category: 'admin', severity: 'notice' },
  'mailbox.created': { category: 'admin', severity: 'notice' },
  'mailbox.updated': { category: 'admin', severity: 'notice' },
  // security: secrets, providers, MCP
  'llm.config_changed': { category: 'admin', severity: 'notice' },
  'llm.provider_key_set': { category: 'security', severity: 'warning' },
  'llm.provider_key_deleted': { category: 'security', severity: 'warning' },
  'mcp.server_created': { category: 'security', severity: 'warning' },
  'mcp.server_updated': { category: 'security', severity: 'warning' },
  'mcp.server_deleted': { category: 'security', severity: 'warning' },
  'mcp.guardrail_updated': { category: 'security', severity: 'warning' },
  // billing
  'billing.pricing_updated': { category: 'billing', severity: 'notice' },
  // channels
  'public_channel.created': { category: 'channel', severity: 'notice' },
  'public_channel.updated': { category: 'channel', severity: 'notice' },
  'public_channel.session_created': { category: 'channel', severity: 'info' },
  'public_channel.message_received': { category: 'channel', severity: 'info' },
  'channel.voice.call_started': { category: 'channel', severity: 'info' },
  'channel.voice.call_ended': { category: 'channel', severity: 'info' },
  'customer_channel_preference.updated': { category: 'channel', severity: 'info' },
  // data / ticket lifecycle
  'reply.sent': { category: 'data', severity: 'notice' },
  'reply.auto_sent': { category: 'data', severity: 'notice' },
  'reply.auto_send_failed': { category: 'data', severity: 'warning' },
  'auto_send': { category: 'data', severity: 'notice' },
  'draft': { category: 'data', severity: 'info' },
  'ai_draft.suggested': { category: 'data', severity: 'info' },
  'summarize': { category: 'data', severity: 'info' },
  'triage': { category: 'data', severity: 'info' },
  'ticket.triaged': { category: 'data', severity: 'info' },
  'ticket.internal_note': { category: 'data', severity: 'info' },
  'ticket.feedback_recorded': { category: 'data', severity: 'info' },
  'ticket.ai_drafts_changed': { category: 'admin', severity: 'info' },
  'escalation': { category: 'procedure', severity: 'notice' },
  'customer.followed_up': { category: 'data', severity: 'info' },
  'customer_memory.extracted': { category: 'data', severity: 'info' },
  'data.customer_memory_viewed': { category: 'security', severity: 'info' },
  'data.ticket_viewed': { category: 'security', severity: 'info' },
  'honest_resolution.verified': { category: 'data', severity: 'info' },
  'honest_resolution.rejected': { category: 'data', severity: 'notice' },
  'automation.duplicate_skipped': { category: 'general', severity: 'info' },
  // approvals
  'approval.created': { category: 'admin', severity: 'notice' },
  'approval.rejected': { category: 'admin', severity: 'notice' },
  'create_approval': { category: 'admin', severity: 'notice' },
  // knowledge
  'knowledge.source_created': { category: 'knowledge', severity: 'notice' },
  'knowledge.source_reindexed': { category: 'knowledge', severity: 'info' },
  'knowledge_plan': { category: 'knowledge', severity: 'info' },
  'knowledge_judge': { category: 'knowledge', severity: 'info' },
  'knowledge_rewrite': { category: 'knowledge', severity: 'info' },
  'insights.kb_suggestion_accepted': { category: 'knowledge', severity: 'notice' },
  'insights.kb_suggestion_status_updated': { category: 'knowledge', severity: 'info' },
  'insights.knowledge_drift_status_updated': { category: 'knowledge', severity: 'info' },
  'proactive.proposed': { category: 'knowledge', severity: 'info' },
  'proactive.accepted': { category: 'knowledge', severity: 'notice' },
  'proactive.rejected': { category: 'knowledge', severity: 'info' },
  'eval.case_captured': { category: 'general', severity: 'info' },
  // procedures
  'procedure.run_started': { category: 'procedure', severity: 'info' },
  'procedure.version_published': { category: 'procedure', severity: 'notice' },
  'procedure.note_added': { category: 'procedure', severity: 'info' },
  'procedure.escalated': { category: 'procedure', severity: 'notice' },
  'procedure.trigger_failed': { category: 'procedure', severity: 'warning' },
  'procedure.resume_failed': { category: 'procedure', severity: 'warning' },
  'marketplace.install': { category: 'procedure', severity: 'notice' },
  // notifications
  'notification.plan_created': { category: 'notification', severity: 'info' },
} satisfies Record<string, AuditActionMeta>;

export type KnownAuditAction = keyof typeof AUDIT_ACTIONS;
/** Known actions get autocomplete + catalog metadata; arbitrary strings still allowed. */
export type AuditAction = KnownAuditAction | (string & {});

export function auditMeta(action: string): AuditActionMeta {
  return (AUDIT_ACTIONS as Record<string, AuditActionMeta>)[action] ?? {
    category: 'general',
    severity: 'info',
  };
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
