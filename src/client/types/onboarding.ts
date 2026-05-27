export interface OnboardingStep {
  id: 'ingest_knowledge' | 'connect_channel' | 'first_reply';
  label: string;
  description: string;
  done: boolean;
  action: { kind: 'navigate'; href: string; label: string };
}

export interface OnboardingStateResponse {
  steps: OnboardingStep[];
  completedCount: number;
  dismissed: boolean;
  shouldShow: boolean;
}
