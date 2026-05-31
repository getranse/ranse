import type { OnboardingStateResponse } from '../../types/client/onboarding';
import { api } from './core';

export const onboardingApi = {
  onboardingState: () => api<OnboardingStateResponse>('/api/onboarding'),
  dismissOnboarding: () => api<{ ok: boolean }>('/api/onboarding/dismiss', { method: 'POST' }),
};
