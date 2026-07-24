import type {
  AuthMe,
  WorkspaceAuditEvent,
  WorkspaceInvitation,
  WorkspaceMailbox,
  WorkspaceMember,
  WorkspaceSummary,
  WorkspaceUsage,
} from '../../interfaces/workspaces';

export type {
  AuthMe,
  WorkspaceAuditEvent,
  WorkspaceInvitation,
  WorkspaceMailbox,
  WorkspaceMember,
  WorkspaceSummary,
  WorkspaceUsage,
};

export const WORKSPACE_ROLES = ['owner', 'admin', 'agent', 'viewer'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
