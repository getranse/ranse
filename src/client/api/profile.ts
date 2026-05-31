import type { MyProfile, ProfileInput } from '../../types/client/profile';
import { api, uploadFile } from './core';

export const profileApi = {
  myProfile: () => api<MyProfile>('/api/me/profile'),
  setMyProfile: (profile: ProfileInput) =>
    api('/api/me/profile', { method: 'POST', body: JSON.stringify(profile) }),
  uploadAvatar: (file: File) => uploadFile('/api/uploads/avatar', file),
};
