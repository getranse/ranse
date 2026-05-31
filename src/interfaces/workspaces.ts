import type { AutonomyPolicy } from '../types/shared/autonomy';
import type { WorkspaceRole } from '../types/shared/workspace';

export interface WorkspaceSettings {
  ai_drafts_enabled: boolean;
  audit_read_logging: boolean;
  from_name: string;
  logo_url: string;
  workspace_name: string;
}

export interface WorkspaceMailboxInput {
  address: string;
  display_name?: string;
  auto_reply_policy?: string;
  autonomy_policy?: AutonomyPolicy;
  autonomy_threshold?: number;
  autonomy_rollout_percent?: number;
}

export interface WorkspaceMailboxUpdate {
  display_name?: string | null;
  auto_reply_policy?: string;
  autonomy_policy?: AutonomyPolicy;
  autonomy_threshold?: number;
  autonomy_rollout_percent?: number;
}

export interface WorkspaceInviteInput {
  email: string;
  role: WorkspaceRole;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  created_at: number;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  accept_url?: string;
  accepted_at: number | null;
  expires_at: number;
  created_at: number;
}

export interface WorkspaceMailbox {
  id: string;
  address: string;
  display_name: string | null;
  auto_reply_policy: string;
  autonomy_policy: AutonomyPolicy;
  autonomy_threshold: number;
  autonomy_rollout_percent: number;
  created_at: number;
}

export interface WorkspaceAuditEvent {
  id: string;
  ticket_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  payload_json: string;
  created_at: number;
}

export interface WorkspaceUsage {
  members: number;
  mailboxes: number;
  tickets: number;
  openTickets: number;
  messages: number;
  knowledgeSources: number;
  notificationChannels: number;
  publicChannels: number;
  llmConfigs: number;
  auditEvents: number;
}

export interface AuthMe {
  authenticated: boolean;
  user?: { id: string; email: string; name: string | null };
  workspaces?: WorkspaceSummary[];
  currentWorkspaceId?: string;
}
