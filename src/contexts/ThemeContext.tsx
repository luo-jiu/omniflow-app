import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(savedTheme) ? savedTheme : 'system';
  } catch {
    return 'system';
  }
}

function readStoredToggleAnchor(): ResolvedThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const savedToggleAnchor = window.localStorage.getItem(THEME_TOGGLE_ANCHOR_STORAGE_KEY);
    return isResolvedThemeMode(savedToggleAnchor) ? savedToggleAnchor : 'light';
  } catch {
    return 'light';
  }
}

function readSystemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(SYSTEM_THEME_QUERY).matches;
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(readSystemPrefersDark);
  const [toggleAnchor, setToggleAnchor] = useState<ResolvedThemeMode>(readStoredToggleAnchor);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    setSystemPrefersDark(mediaQuery.matches);

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

  useLayoutEffect(() => {
    document.body.setAttribute('theme-mode', resolvedTheme);
    document.body.setAttribute('theme-source', theme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      window.localStorage.setItem(THEME_TOGGLE_ANCHOR_STORAGE_KEY, toggleAnchor);
    } catch {
      // Theme remains active for this session when storage is unavailable.
    }
    if (window.electronWindow?.setThemeSource) {
      window.electronWindow.setThemeSource(theme === 'system' ? 'system' : resolvedTheme);
    }
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
      return 'system';
    }

    if (theme === 'dark') {
      applyTheme('system', 'dark');
      return 'system';
    }

    const nextTheme: ResolvedThemeMode = toggleAnchor === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme, nextTheme);
    return nextTheme;
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
