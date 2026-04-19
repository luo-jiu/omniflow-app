import React, { useEffect, type ReactNode } from 'react';

const THEME_STORAGE_KEY = 'app-theme';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedThemeMode = 'light' | 'dark';

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable; fall through
  }
  return 'light';
}

function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

function applyThemeAttribute(resolved: ResolvedThemeMode, source: ThemeMode) {
  document.body.setAttribute('theme-mode', resolved);
  document.body.setAttribute('theme-source', source);
}

export const OverlayThemeBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    let currentSource = readStoredTheme();
    let prefersDark = mediaQuery.matches;
    applyThemeAttribute(resolveTheme(currentSource, prefersDark), currentSource);

    const handleMediaChange = (event: MediaQueryListEvent) => {
      prefersDark = event.matches;
      applyThemeAttribute(resolveTheme(currentSource, prefersDark), currentSource);
    };
    mediaQuery.addEventListener('change', handleMediaChange);

    // Main renderer writes localStorage on theme change; 'storage' event fires across same-origin windows
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      currentSource = readStoredTheme();
      applyThemeAttribute(resolveTheme(currentSource, prefersDark), currentSource);
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return <>{children}</>;
};
