// Semantic status/priority chips — color carries meaning, never decoration.
// Uses the soft/solid token pairs so it reads in both themes.
type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-hover text-muted',
};

const STATUS_TONE: Record<string, Tone> = {
  open: 'info',
  pending: 'warning',
  resolved: 'success',
  closed: 'neutral',
  spam: 'danger',
};

const PRIORITY_TONE: Record<string, Tone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs capitalize ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Pill>;
}

/** Priority chip — only rendered for high/urgent (normal/low are visual noise). */
export function PriorityPill({ priority }: { priority: string }) {
  if (priority !== 'high' && priority !== 'urgent') return null;
  return <Pill tone={PRIORITY_TONE[priority]}>{priority}</Pill>;
}
