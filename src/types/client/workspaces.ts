import type { WorkspaceSettings, WorkspaceMailboxInput, WorkspaceMailboxUpdate, WorkspaceInviteInput } from '../../interfaces/workspaces';
export type { WorkspaceSettings, WorkspaceMailboxInput, WorkspaceMailboxUpdate, WorkspaceInviteInput };

export type WorkspaceSettingsInput = Partial<
  Pick<WorkspaceSettings, 'ai_drafts_enabled' | 'audit_read_logging' | 'from_name' | 'logo_url'>
>;
