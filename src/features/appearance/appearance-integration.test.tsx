import React, { useContext } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AppearanceControlContext, AppearanceViewContext, type AppearanceControls } from './appearance.context';
import { ThemeContext } from '@/contexts/theme.context';
import { APPEARANCE_STORAGE_PREFIX } from './appearance-storage';
import { BUILT_IN_COLOR_THEMES, findBuiltInColorTheme } from './built-in-themes';
import { resolveAppearanceTheme } from './appearance-theme';

let renderer: TestRenderer.ReactTestRenderer | undefined;
let controls: AppearanceControls;
let context: NonNullable<React.ContextType<typeof ThemeContext>>;
let view: NonNullable<React.ContextType<typeof AppearanceViewContext>>;
function Probe() { controls = useContext(AppearanceControlContext)!; context = useContext(ThemeContext)!; view = useContext(AppearanceViewContext)!; return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.stubGlobal('document', { body: { setAttribute: vi.fn(), style: { setProperty: vi.fn() } } });
  act(() => { renderer = TestRenderer.create(<ThemeProvider><Probe /></ThemeProvider>); });
  return { values, storage };
}
describe('appearance owner integration', () => {
  it('previews independently, cancels, saves and restores the scoped choice', () => {
    const { values } = setup();
    act(() => controls.bindAccount('user:900001', 'dark'));
    const before = controls.selection;
    let token!: ReturnType<AppearanceControls['preview']>;
    act(() => { token = controls.preview({ ...before, colorThemeId: 'omniflow.ocean', iconThemeId: 'omniflow.outline' }); });
    expect(view.colors['surface.app']).toBe('#172231');
    expect(values.has(APPEARANCE_STORAGE_PREFIX + 'user:900001')).toBe(false);
    act(() => controls.cancel(token));
    expect(view.colors['surface.app']).toBe('#1e1e1e');
    act(() => { token = controls.preview({ ...before, colorThemeId: 'omniflow.ocean', iconThemeId: 'omniflow.outline' }); });
    act(() => { expect(controls.confirm(token)).toBe(true); });
    expect(JSON.parse(values.get(APPEARANCE_STORAGE_PREFIX + 'user:900001')!).colorThemeId).toBe('omniflow.ocean');
    act(() => controls.bindAccount('user:900002', 'light'));
    expect(view.colors['surface.app']).toBe('#f5f5f0');
    act(() => controls.bindAccount('user:900001', 'light'));
    expect(view.colors['surface.app']).toBe('#172231');
    expect(view.iconThemeId).toBe('omniflow.outline');
  });
  it('rolls back a failed local save and ignores an old account preview', () => {
    const { storage } = setup();
    act(() => controls.bindAccount('user:900001', 'light'));
    let token!: ReturnType<AppearanceControls['preview']>;
    act(() => { token = controls.preview({ ...controls.selection, colorThemeId: 'omniflow.ocean' }); });
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    act(() => { expect(controls.confirm(token)).toBe(false); });
    expect(view.colors['surface.app']).toBe('#f5f5f0');
    act(() => controls.bindAccount('user:900002', 'dark'));
    act(() => { expect(controls.confirm(token)).toBe(false); });
    expect(context.resolvedTheme).toBe('dark');
  });
  it('retains a preview token when changing mode and cancels all unsaved choices', () => {
    const { values } = setup();
    act(() => controls.bindAccount('user:900001', 'light'));
    let token!: ReturnType<AppearanceControls['preview']>;
    act(() => { token = controls.preview({ ...controls.selection, colorThemeId: 'omniflow.ocean' }); });
    act(() => context.setTheme('dark'));
    expect(view.colors['surface.app']).toBe('#172231');
    expect(values.has(APPEARANCE_STORAGE_PREFIX + 'user:900001')).toBe(false);
    act(() => controls.cancel(token));
    expect(context.theme).toBe('light');
    expect(view.colors['surface.app']).toBe('#f5f5f0');
  });
  it('retains unavailable choices while projecting the built-in fallback', () => {
    const { values } = setup();
    values.set(APPEARANCE_STORAGE_PREFIX + 'user:900001', JSON.stringify({ mode: 'dark', colorThemeId: 'missing.theme', iconThemeId: 'missing.icons' }));
    act(() => controls.bindAccount('user:900001', 'light'));
    expect(controls.selection.colorThemeId).toBe('missing.theme');
    expect(view.colors['surface.app']).toBe('#1e1e1e');
    expect(view.iconThemeId).toBe('missing.icons');
  });
  it('validates every built-in color variant', () => {
    for (const theme of BUILT_IN_COLOR_THEMES) for (const mode of ['light', 'dark'] as const) {
      expect(resolveAppearanceTheme({ theme: findBuiltInColorTheme(theme.id), mode }).errors).toEqual([]);
    }
  });
});
