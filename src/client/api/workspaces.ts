import type {
  WorkspaceInviteInput,
  WorkspaceMailboxInput,
  WorkspaceMailboxUpdate,
  WorkspaceSettings,
  WorkspaceSettingsInput,
} from '../../types/client/workspaces';
import type { AuditEventRecord, AuditQuery } from '../../types/shared/audit';
import type { WorkspaceOutcomeDaily } from '../../types/shared/autonomy';
import type {
  WorkspaceInvitation,
  WorkspaceMailbox,
  WorkspaceMember,
  WorkspaceSummary,
  WorkspaceUsage,
} from '../../types/shared/workspaces';
import { api, uploadFile } from './core';

function auditQueryString(query: AuditQuery): string {
  const p = new URLSearchParams();
  if (query.action) p.set('action', query.action);
  if (query.category) p.set('category', query.category);
  if (query.actorId) p.set('actor_id', query.actorId);
  if (query.ticketId) p.set('ticket_id', query.ticketId);
  if (query.from) p.set('from', String(query.from));
  if (query.to) p.set('to', String(query.to));
  if (query.limit) p.set('limit', String(query.limit));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

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
  workspaceSettings: () => api<WorkspaceSettings>('/api/settings/workspace'),
  setWorkspaceSettings: (settings: WorkspaceSettingsInput) =>
    api('/api/settings/workspace', { method: 'POST', body: JSON.stringify(settings) }),
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
  workspaceAudit: (query: AuditQuery = {}) =>
    api<{ events: AuditEventRecord[] }>(`/api/workspaces/current/audit${auditQueryString(query)}`),
  workspaceAuditVerify: () =>
    api<{ ok: boolean; checked: number; brokenAt?: string }>(
      '/api/workspaces/current/audit/verify',
    ),
  workspaceAuditExportUrl: (query: AuditQuery = {}) =>
    `/api/workspaces/current/audit/export?format=csv${auditQueryString(query).replace('?', '&')}`,
  workspaceOutcomeRollup: (days = 30) =>
    api<{ days: WorkspaceOutcomeDaily[] }>(`/api/workspaces/current/outcomes/rollup?days=${days}`),
  workspaceExport: () => api<any>('/api/workspaces/current/export'),
  workspaceMailboxes: () =>
    api<{ mailboxes: WorkspaceMailbox[] }>('/api/workspaces/current/mailboxes'),
  createWorkspaceMailbox: (body: WorkspaceMailboxInput) =>
    api<{ ok: boolean; mailbox: WorkspaceMailbox }>('/api/workspaces/current/mailboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWorkspaceMailbox: (id: string, body: WorkspaceMailboxUpdate) =>
    api(`/api/workspaces/current/mailboxes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  workspaceMembers: () => api<{ members: WorkspaceMember[] }>('/api/workspaces/current/members'),
  workspaceInvitations: () =>
    api<{ invitations: WorkspaceInvitation[] }>('/api/workspaces/current/invitations'),
  inviteWorkspaceMember: (body: WorkspaceInviteInput) =>
    api<{ ok: boolean; invitation: WorkspaceInvitation }>('/api/workspaces/current/invitations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWorkspaceMember: (userId: string, role: WorkspaceInviteInput['role']) =>
    api(`/api/workspaces/current/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeWorkspaceMember: (userId: string) =>
    api(`/api/workspaces/current/members/${userId}`, { method: 'DELETE' }),
  uploadWorkspaceLogo: (file: File) => uploadFile('/api/uploads/workspace-logo', file),
};
