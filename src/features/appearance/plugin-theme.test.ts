import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR_TOKENS } from './color-theme';
import { toPluginThemeSnapshot } from './plugin-theme';

describe('plugin theme projection', () => {
  it('copies all resolved colors without host identity or ownership metadata', () => {
    const colors = { ...DEFAULT_COLOR_TOKENS.dark, 'accent.default': '#9876ed' };
    const view = { mode: 'dark' as const, colors, ownerEpoch: 'private-owner', accountScope: 'private-account', revision: 80, iconThemeId: 'private-icon' };
    const theme = toPluginThemeSnapshot(view, 3);
    expect(theme).toEqual({ schemaVersion: 1, revision: 3, mode: 'dark', colors });
    expect(theme.colors).not.toBe(colors);
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.colors)).toBe(true);
    colors['accent.default'] = '#000000';
    expect(theme.colors['accent.default']).toBe('#9876ed');
  });

  it('provides the complete built-in light palette before the appearance provider is available', () => {
    expect(toPluginThemeSnapshot(null, 0)).toEqual({ schemaVersion: 1, revision: 0, mode: 'light', colors: DEFAULT_COLOR_TOKENS.light });
  });
});
