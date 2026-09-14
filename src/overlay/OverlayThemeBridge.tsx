import React, { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider as StyledThemeProvider } from 'styled-components';
import { AppearanceViewContext } from '@/features/appearance/appearance.context';
import { validateThemeView, type ThemeView } from '@/features/appearance/theme-view';
import { applyThemeView } from '@/features/appearance/theme-dom';
import { subscribeAppearance } from '@/service/appearance/appearance.api';
import { createThemeState, createThemeSnapshot } from '@/features/appearance/theme-state';
import { toThemeView } from '@/features/appearance/theme-view';
import { defaultSelection } from '@/features/appearance/appearance-storage';
import { findBuiltInColorTheme } from '@/features/appearance/built-in-themes';
import legacyStyledTheme from '@/assets/theme';

export const OverlayThemeBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [view, setView] = useState<ThemeView>(() => toThemeView(createThemeSnapshot(createThemeState({ ownerEpoch: 'overlay-initial', accountScope: 'anonymous', systemMode: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', selection: defaultSelection() }), findBuiltInColorTheme)));
  useLayoutEffect(() => subscribeAppearance(input => {
    const incoming = validateThemeView(input);
    if (!incoming) return;
    setView(current => incoming.ownerEpoch === current.ownerEpoch && incoming.revision <= current.revision ? current : incoming);
  }), []);
  useLayoutEffect(() => { applyThemeView(view); }, [view]);
  const styledTheme = useMemo(() => ({ ...legacyStyledTheme, color: { primary: view.colors['accent.default'], secondary: view.colors['accent.active'] } }), [view]);
  return <AppearanceViewContext.Provider value={view}><StyledThemeProvider theme={styledTheme}>{children}</StyledThemeProvider></AppearanceViewContext.Provider>;
};
