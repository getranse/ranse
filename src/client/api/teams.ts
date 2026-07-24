import type { Team } from '../../interfaces/teams';
import { api } from './core';

export const teamApi = {
  teams: () => api<{ teams: Team[] }>('/api/teams'),
  createTeam: (name: string) =>
    api<{ team: Team }>('/api/teams', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteTeam: (id: string) => api<any>(`/api/teams/${id}`, { method: 'DELETE' }),
  teamMembers: (id: string) =>
    api<{ members: Array<{ user_id: string; email: string; name: string | null }> }>(
      `/api/teams/${id}/members`,
    ),
  addTeamMember: (id: string, userId: string) =>
    api<any>(`/api/teams/${id}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  removeTeamMember: (id: string, userId: string) =>
    api<any>(`/api/teams/${id}/members/${userId}`, { method: 'DELETE' }),
};
