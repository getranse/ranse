import type { AuthMe } from '../../types/shared/workspace';
import { api } from './core';

export const authApi = {
  login: (email: string, password: string) =>
    api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  revokeOtherSessions: () =>
    api<{ ok: boolean; revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' }),
  me: () => api<AuthMe>('/auth/me'),
};
