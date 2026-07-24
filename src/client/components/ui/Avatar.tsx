// Deterministic initials avatar — same input always yields the same hue, so a
// requester keeps a stable color across the app without storing anything.
const HUES = [8, 28, 152, 200, 262, 292, 330];

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const hue = hueFor(name || '?');
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        color: `hsl(${hue} 55% 32%)`,
        background: `hsl(${hue} 70% 90%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
