import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { initThemeFromStorage } from './components/common/ThemeToggle';
import './styles.css';

// Apply the user's stored theme before React mounts so there's no
// light-to-dark flash on first paint.
initThemeFromStorage();

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
