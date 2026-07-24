import type { AuthMe } from '../../types/shared/workspace';
import { api } from './core';

export const authApi = {
  login: (email: string, password: string, totpCode?: string) =>
    api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, totpCode }) }),
  totpSetup: () => api<{ secret: string; uri: string }>('/auth/totp/setup', { method: 'POST' }),
  totpVerify: (code: string) =>
    api('/auth/totp/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  totpDisable: (code: string) =>
    api('/auth/totp/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  revokeOtherSessions: () =>
    api<{ ok: boolean; revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' }),
  me: () => api<AuthMe>('/auth/me'),
};
