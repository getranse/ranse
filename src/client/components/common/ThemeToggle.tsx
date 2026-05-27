import { useEffect, useState } from 'react';

// Theme override. The CSS in base.css follows prefers-color-scheme when
// no `data-theme` attribute is set on <html>; this component flips that
// attribute (and persists the choice in localStorage). Three states:
//   - system: removes data-theme, OS picks
//   - light:  data-theme="light"
//   - dark:   data-theme="dark"

type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ranse:theme';

function readStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function initThemeFromStorage(): void {
  if (typeof window === 'undefined') return;
  applyTheme(readStoredTheme());
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* no-op when storage is unavailable (private mode) */
    }
  }, [mode]);

  return (
    <fieldset className="theme-toggle" aria-label="Theme">
      <legend className="visually-hidden">Theme</legend>
      {(['system', 'light', 'dark'] as const).map((opt) => (
        <button
          type="button"
          key={opt}
          className={mode === opt ? 'active' : ''}
          aria-pressed={mode === opt}
          onClick={() => setMode(opt)}
          title={`${opt[0].toUpperCase()}${opt.slice(1)} theme`}
        >
          {opt === 'system' ? 'Auto' : opt === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </fieldset>
  );
}
