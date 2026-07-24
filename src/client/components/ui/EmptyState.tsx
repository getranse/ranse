import type { ReactNode } from 'react';

/** Designed empty pane — never a blank area. Centered glyph, headline, one
 * muted subline, and at most one action. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 text-3xl text-subtle">{icon}</div>}
      <div className="font-semibold text-md text-text">{title}</div>
      {hint && <div className="max-w-xs text-muted text-sm leading-relaxed">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
