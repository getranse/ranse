// First-run onboarding state. Derived rather than persisted: the
// authoritative source is "did the workspace ever have a KB source / a
// public channel / an outbound message" — querying the underlying tables
// directly. The only persisted bit is whether the operator dismissed the
// banner (stored in `workspace.settings_json.onboarding_dismissed_at`).
//
// Derived state lets us drop the banner the moment activity exists,
// without needing each producer to remember to update the wizard.

export interface OnboardingStep {
  id: 'ingest_knowledge' | 'connect_channel' | 'first_reply';
  label: string;
  description: string;
  done: boolean;
  action: { kind: 'navigate'; href: string; label: string };
}

export interface OnboardingState {
  steps: OnboardingStep[];
  completedCount: number;
  dismissed: boolean;
  shouldShow: boolean;
}

export interface OnboardingStateResponse {
  steps: OnboardingStep[];
  completedCount: number;
  dismissed: boolean;
  shouldShow: boolean;
}
