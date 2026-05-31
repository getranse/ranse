import type { WorkspaceSummary, WorkspaceMember, WorkspaceInvitation, WorkspaceMailbox, WorkspaceAuditEvent, WorkspaceUsage, AuthMe } from '../../interfaces/workspaces';
export type { WorkspaceSummary, WorkspaceMember, WorkspaceInvitation, WorkspaceMailbox, WorkspaceAuditEvent, WorkspaceUsage, AuthMe };

export const WORKSPACE_ROLES = ['owner', 'admin', 'agent', 'viewer'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
