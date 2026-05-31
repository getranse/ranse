/** Shared client-side formatting helpers. Keep display logic here, not inline in components. */

export function formatDateTime(ts: number | string | Date): string {
  return new Date(ts).toLocaleString();
}

export function formatDate(ts: number | string | Date): string {
  return new Date(ts).toLocaleDateString();
}

export function formatCents(cents: number, currency: string): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${dollars}`;
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
