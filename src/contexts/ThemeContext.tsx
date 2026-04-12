import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeContext, type ResolvedThemeMode, type ThemeMode } from './theme.context';

const THEME_STORAGE_KEY = 'app-theme';
const THEME_TOGGLE_ANCHOR_STORAGE_KEY = 'app-theme-toggle-anchor';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'system' || value === 'dark';
}

function isResolvedThemeMode(value: string | null): value is ResolvedThemeMode {
  return value === 'light' || value === 'dark';
}

function resolveThemeMode(theme: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return theme;
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>('light');
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [toggleAnchor, setToggleAnchor] = useState<ResolvedThemeMode>('light');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const savedToggleAnchor = localStorage.getItem(THEME_TOGGLE_ANCHOR_STORAGE_KEY);
    setSystemPrefersDark(mediaQuery.matches);
    setThemeState(isThemeMode(savedTheme) ? savedTheme : 'light');
    setToggleAnchor(isResolvedThemeMode(savedToggleAnchor) ? savedToggleAnchor : 'light');

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  const resolvedTheme = useMemo(
    () => resolveThemeMode(theme, systemPrefersDark),
    [systemPrefersDark, theme],
  );

  useEffect(() => {
    document.body.setAttribute('theme-mode', resolvedTheme);
    document.body.setAttribute('theme-source', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(THEME_TOGGLE_ANCHOR_STORAGE_KEY, toggleAnchor);
  }, [resolvedTheme, theme, toggleAnchor]);

  const applyTheme = useCallback((mode: ThemeMode, nextToggleAnchor?: ResolvedThemeMode) => {
    setThemeState(mode);
    if (nextToggleAnchor) {
      setToggleAnchor(nextToggleAnchor);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    if (theme === 'light') {
      applyTheme('system', 'light');
      return;
    }

    if (theme === 'dark') {
      applyTheme('system', 'dark');
      return;
    }

    const nextTheme: ResolvedThemeMode = toggleAnchor === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme, nextTheme);
  }, [applyTheme, theme, toggleAnchor]);

  const setTheme = useCallback((mode: ThemeMode) => {
    applyTheme(mode, mode === 'system' ? undefined : mode);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
