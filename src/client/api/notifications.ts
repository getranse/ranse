import type {
  NotificationChannel,
  NotificationChannelInput,
  NotificationMeta,
} from '../types/notifications';
import { api } from './core';

export const notificationApi = {
  notificationsMeta: () => api<NotificationMeta>('/api/notifications/meta'),
  listNotificationChannels: () =>
    api<{ channels: NotificationChannel[] }>('/api/notifications/channels'),
  createNotificationChannel: (body: NotificationChannelInput) =>
    api<{ ok: boolean; id: string }>('/api/notifications/channels', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateNotificationChannel: (
    id: string,
    body: { enabled?: boolean; events?: string[]; label?: string | null },
  ) => api(`/api/notifications/channels/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNotificationChannel: (id: string) =>
    api(`/api/notifications/channels/${id}`, { method: 'DELETE' }),
  testNotificationChannel: (id: string) =>
    api<{ ok: boolean }>(`/api/notifications/channels/${id}/test`, { method: 'POST' }),
};
