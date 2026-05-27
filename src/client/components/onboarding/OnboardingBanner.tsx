import { useEffect, useState } from 'react';
import { API, type OnboardingStateResponse } from '../../api';

// Onboarding checklist banner. Renders at the top of the Inbox until the
// operator either completes all three steps (auto-hidden) or dismisses
// manually. State is derived from real activity, so creating a knowledge
// source / channel / outbound reply flips the corresponding step
// automatically — no client-side bookkeeping required.

interface OnboardingBannerProps {
  onNavigate: (href: string) => void;
}

export function OnboardingBanner({ onNavigate }: OnboardingBannerProps) {
  const [state, setState] = useState<OnboardingStateResponse | null>(null);

  useEffect(() => {
    API.onboardingState()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  if (!state?.shouldShow) return null;

  async function dismiss() {
    setState((prev) => (prev ? { ...prev, dismissed: true, shouldShow: false } : prev));
    try {
      await API.dismissOnboarding();
    } catch {
      // Local hide already happened; server retry on next page load is fine.
    }
  }

  const total = state.steps.length;
  const done = state.completedCount;
  return (
    <section className="onboarding-banner" aria-label="Setup checklist">
      <div className="onboarding-banner-header">
        <div className="onboarding-banner-title">Get Ranse working in three steps</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="onboarding-banner-progress">
            {done} / {total} complete
          </div>
          <button
            type="button"
            className="ghost"
            onClick={dismiss}
            aria-label="Dismiss setup checklist"
          >
            Dismiss
          </button>
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {state.steps.map((step, idx) => (
          <li
            key={step.id}
            className={`onboarding-step${step.done ? ' done' : ''}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: '8px 0',
            }}
          >
            <span className="dot">{step.done ? '✓' : idx + 1}</span>
            <div>
              <div className="label" style={{ fontWeight: 500 }}>
                {step.label}
              </div>
              <div className="desc">{step.description}</div>
            </div>
            {!step.done && (
              <button type="button" onClick={() => onNavigate(step.action.href)}>
                {step.action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
