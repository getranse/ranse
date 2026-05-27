import { api } from './core';

export const approvalApi = {
  approve: (id: string, edits?: any) =>
    api(`/api/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ edits }) }),
  reject: (id: string, reason?: string) =>
    api(`/api/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
