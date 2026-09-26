import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThemeProvider as StyledThemeProvider } from 'styled-components';
import { ThemeContext, type ThemeMode } from './theme.context';
import { createThemeSnapshot, createThemeState, transitionTheme, type ThemeAction, type ThemeOperationToken, type ThemeSelection } from '@/features/appearance/theme-state';
import { AppearanceControlContext, AppearanceViewContext } from '@/features/appearance/appearance.context';
import { defaultSelection, readAppearance, saveAppearance } from '@/features/appearance/appearance-storage';
import { findBuiltInColorTheme } from '@/features/appearance/built-in-themes';
import { toThemeView } from '@/features/appearance/theme-view';
import { applyThemeView, cancelThemeTransition } from '@/features/appearance/theme-dom';
import { publishAppearance } from '@/service/appearance/appearance.api';
import legacyStyledTheme from '@/assets/theme';

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';
function storedMode(): ThemeMode {
  try { const mode = localStorage.getItem('app-theme'); if (mode === 'light' || mode === 'dark') return mode; } catch { /* default */ }
  return 'system';
}
function systemMode() { return window.matchMedia?.(SYSTEM_THEME_QUERY).matches ? 'dark' as const : 'light' as const; }

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState(() => createThemeState({ ownerEpoch: crypto.randomUUID(), accountScope: 'anonymous', systemMode: systemMode(), selection: readAppearance('anonymous', defaultSelection(storedMode())) }));
  const stateRef = useRef(state);
  const anchor = useRef<'light' | 'dark'>(state.committed.mode === 'dark' ? 'dark' : 'light');
  const previewAnchor = useRef<'light' | 'dark' | null>(null);
  const dispatch = useCallback((action: ThemeAction) => {
    const result = transitionTheme(stateRef.current, action);
    stateRef.current = result.state;
    let success = true;
    if (result.write) {
      try { saveAppearance(result.state.accountScope, result.write.selection); }
      catch { success = false; }
      stateRef.current = transitionTheme(result.state, { type: 'save-result', token: result.write.token, success }).state;
    }
    setState(stateRef.current);
    return { ...result, success };
  }, []);
  const preview = useCallback((selection: ThemeSelection) => {
    if (!stateRef.current.preview) previewAnchor.current = anchor.current;
    return dispatch({ type: 'preview', selection }).state.preview!.token;
  }, [dispatch]);
  const cancel = useCallback((token: ThemeOperationToken) => {
    const wasPreviewing = Boolean(stateRef.current.preview);
    const result = dispatch({ type: 'cancel', token });
    if (wasPreviewing && !result.state.preview) { if (previewAnchor.current) anchor.current = previewAnchor.current; previewAnchor.current = null; }
  }, [dispatch]);
  const confirm = useCallback((token: ThemeOperationToken) => {
    const result = dispatch({ type: 'confirm', token });
    if (result.write) { if (!result.success && previewAnchor.current) anchor.current = previewAnchor.current; previewAnchor.current = null; }
    return Boolean(result.write && result.success);
  }, [dispatch]);
  const bindAccount = useCallback((accountScope: string, mode: ThemeMode) => {
    if (stateRef.current.accountScope === accountScope) return;
    const selected = readAppearance(accountScope, defaultSelection(accountScope === 'anonymous' ? storedMode() : mode));
    previewAnchor.current = null;
    if (selected.mode !== 'system') anchor.current = selected.mode;
    dispatch({ type: 'scope', accountScope, selection: selected });
  }, [dispatch]);
  const setTheme = useCallback((mode: ThemeMode) => {
    const previousAnchor = anchor.current;
    if (mode !== 'system') anchor.current = mode;
    if (stateRef.current.preview) {
      const current = stateRef.current.preview;
      dispatch({ type: 'update-preview', token: current.token, selection: { ...current.selection, mode } });
      return;
    }
    const current = stateRef.current.committed;
    const token = preview({ ...current, mode });
    previewAnchor.current = previousAnchor;
    confirm(token);
  }, [confirm, preview, dispatch]);
  const toggleTheme = useCallback((): ThemeMode => {
    const current = stateRef.current.preview?.selection.mode ?? stateRef.current.committed.mode;
    const next = current === 'system' ? (anchor.current === 'light' ? 'dark' : 'light') : 'system';
    setTheme(next);
    return stateRef.current.preview?.selection.mode ?? stateRef.current.committed.mode;
  }, [setTheme]);
  useEffect(() => {
    const media = window.matchMedia?.(SYSTEM_THEME_QUERY);
    if (!media) return;
    const update = () => dispatch({ type: 'system', mode: media.matches ? 'dark' : 'light' });
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [dispatch]);
  const snapshot = useMemo(() => createThemeSnapshot(state, findBuiltInColorTheme), [state]);
  const view = useMemo(() => toThemeView(snapshot), [snapshot]);
  useLayoutEffect(() => { applyThemeView(view); }, [view]);
  useLayoutEffect(() => () => cancelThemeTransition(), []);
  useEffect(() => { void publishAppearance(view).catch(() => undefined); }, [view]);
  useEffect(() => {
    if (state.accountScope !== 'anonymous') return;
    try { localStorage.setItem('app-theme', state.committed.mode); } catch { /* selection remains usable */ }
  }, [state.accountScope, state.committed]);
  const styledTheme = useMemo(() => ({ ...legacyStyledTheme, color: { primary: view.colors['accent.default'], secondary: view.colors['accent.active'] } }), [view]);
  return <ThemeContext.Provider value={{ theme: snapshot.requested.mode, resolvedTheme: snapshot.resolved.mode, toggleTheme, setTheme }}>
    <AppearanceControlContext.Provider value={{ selection: snapshot.requested, phase: snapshot.phase, preview, cancel, confirm, bindAccount }}>
      <AppearanceViewContext.Provider value={view}>
        <StyledThemeProvider theme={styledTheme}>{children}</StyledThemeProvider>
      </AppearanceViewContext.Provider>
    </AppearanceControlContext.Provider>
  </ThemeContext.Provider>;
};
