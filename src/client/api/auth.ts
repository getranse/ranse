import type { AuthMe } from '../../types/workspace';
import { api } from './core';

export const authApi = {
  login: (email: string, password: string) =>
    api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  me: () => api<AuthMe>('/auth/me'),
};
