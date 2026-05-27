import type { AutonomyPolicy } from '../../types/autonomy';
import type { WorkspaceRole } from '../../types/workspace';

export interface WorkspaceSettings {
  ai_drafts_enabled: boolean;
  audit_read_logging: boolean;
  from_name: string;
  logo_url: string;
  workspace_name: string;
}

export type WorkspaceSettingsInput = Partial<
  Pick<WorkspaceSettings, 'ai_drafts_enabled' | 'audit_read_logging' | 'from_name' | 'logo_url'>
>;

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
