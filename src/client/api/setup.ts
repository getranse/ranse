import type { ProvisionInput } from '../types/setup';
import { api } from './core';

export const setupApi = {
  setupStatus: () => api<{ completed: boolean }>('/setup/status'),
  bootstrap: (body: any) => api('/setup/bootstrap', { method: 'POST', body: JSON.stringify(body) }),
  addMailbox: (body: any) => api('/setup/mailbox', { method: 'POST', body: JSON.stringify(body) }),
  provision: (body: ProvisionInput) =>
    api<{ ok: boolean; steps: any[] }>('/setup/provision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  verify: () => api('/setup/verify', { method: 'POST' }),
};
