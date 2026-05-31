import type {
  PublicChannelEntry,
  PublicChannelInput,
  PublicChannelUpdate,
} from '../../types/client/channels';
import { api } from './core';

export const channelApi = {
  listPublicChannels: () => api<{ channels: PublicChannelEntry[] }>('/api/channels/public'),
  createPublicChannel: (body: PublicChannelInput) =>
    api<{ channel: PublicChannelEntry }>('/api/channels/public', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePublicChannel: (id: string, body: PublicChannelUpdate) =>
    api<{ channel: PublicChannelEntry }>(`/api/channels/public/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
