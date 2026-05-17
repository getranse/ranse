import type {
  WorkspaceAuditEvent,
  WorkspaceInvitation,
  WorkspaceMailbox,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
  WorkspaceUsage,
} from '../types/workspace';
import type { AutonomyPolicy } from '../types/autonomy';
import type { WorkspaceOutcomeDaily } from '../types/autonomy';
import { api, uploadFile } from './api-core';

export const workspaceApi = {
  createWorkspace: (name: string) =>
    api<{ ok: boolean; workspaceId: string; workspace: WorkspaceSummary }>('/auth/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  switchWorkspace: (workspaceId: string) =>
    api<{ ok: boolean; workspaceId: string; workspace: WorkspaceSummary }>(
      '/auth/workspaces/switch',
      { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId }) },
    ),
  acceptInvitation: (token: string) =>
    api<{ ok: boolean; workspaceId: string; workspace: WorkspaceSummary }>(
      '/auth/invitations/accept',
      { method: 'POST', body: JSON.stringify({ token }) },
    ),
  workspaceSettings: () =>
    api<{
      ai_drafts_enabled: boolean;
      from_name: string;
      logo_url: string;
      workspace_name: string;
    }>('/api/settings/workspace'),
  setWorkspaceSettings: (settings: {
    ai_drafts_enabled?: boolean;
    from_name?: string;
    logo_url?: string;
  }) => api('/api/settings/workspace', { method: 'POST', body: JSON.stringify(settings) }),
  updateWorkspace: (body: { name: string }) =>
    api('/api/workspaces/current', { method: 'PATCH', body: JSON.stringify(body) }),
  archiveWorkspace: () =>
    api<{ ok: boolean; currentWorkspaceId?: string }>('/api/workspaces/current/archive', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'archive' }),
    }),
  deleteWorkspace: () =>
    api<{ ok: boolean; currentWorkspaceId?: string }>('/api/workspaces/current', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'delete' }),
    }),
  transferWorkspaceOwnership: (userId: string) =>
    api('/api/workspaces/current/transfer-ownership', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
  workspaceUsage: () => api<{ usage: WorkspaceUsage }>('/api/workspaces/current/usage'),
  workspaceAudit: () => api<{ events: WorkspaceAuditEvent[] }>('/api/workspaces/current/audit'),
  workspaceOutcomeRollup: (days = 30) =>
    api<{ days: WorkspaceOutcomeDaily[] }>(`/api/workspaces/current/outcomes/rollup?days=${days}`),
  workspaceExport: () => api<any>('/api/workspaces/current/export'),
  workspaceMailboxes: () =>
    api<{ mailboxes: WorkspaceMailbox[] }>('/api/workspaces/current/mailboxes'),
  createWorkspaceMailbox: (body: {
    address: string;
    display_name?: string;
    auto_reply_policy?: string;
    autonomy_policy?: AutonomyPolicy;
    autonomy_threshold?: number;
    autonomy_rollout_percent?: number;
  }) =>
    api<{ ok: boolean; mailbox: WorkspaceMailbox }>('/api/workspaces/current/mailboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWorkspaceMailbox: (
    id: string,
    body: {
      display_name?: string | null;
      auto_reply_policy?: string;
      autonomy_policy?: AutonomyPolicy;
      autonomy_threshold?: number;
      autonomy_rollout_percent?: number;
    },
  ) =>
    api(`/api/workspaces/current/mailboxes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  workspaceMembers: () => api<{ members: WorkspaceMember[] }>('/api/workspaces/current/members'),
  workspaceInvitations: () =>
    api<{ invitations: WorkspaceInvitation[] }>('/api/workspaces/current/invitations'),
  inviteWorkspaceMember: (body: { email: string; role: WorkspaceRole }) =>
    api<{ ok: boolean; invitation: WorkspaceInvitation }>('/api/workspaces/current/invitations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWorkspaceMember: (userId: string, role: WorkspaceRole) =>
    api(`/api/workspaces/current/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeWorkspaceMember: (userId: string) =>
    api(`/api/workspaces/current/members/${userId}`, { method: 'DELETE' }),
  uploadWorkspaceLogo: (file: File) => uploadFile('/api/uploads/workspace-logo', file),
};
