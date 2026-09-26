import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveAppearanceTheme } from './appearance-theme';
import { defaultSelection } from './appearance-storage';
import { BUILT_IN_COLOR_THEMES, findBuiltInColorTheme } from './built-in-themes';
import { COLOR_CSS_VARIABLES, type ColorToken } from './color-theme';
import { toSemiThemeVariables } from './theme-adapters';

const addedRoles = new Set<ColorToken>([
  'accent.foreground', 'navigation.active',
  'control.selected.background', 'control.selected.hover', 'control.selected.active',
]);

// Fingerprints of all 62 resolved legacy colors, captured before adding Violet.
// Exclude only the new roles so an unrelated historical color cannot drift unnoticed.
const legacyPalettes = [
  ['light', 'omniflow.default', '16cefff87703c1dde90f427a6d791965beab8894337a8851fb8e3aac63ef744c'],
  ['light', 'omniflow.ocean', '1a9e93c9c2bcc170d5573e40abd71985d7d6bc12838f118504c85a95f3097267'],
  ['dark', 'omniflow.default', '43c194d2cbdf0f56804a9198c4ce9a2abf231cf0d80414e18784d36a9fe34d0d'],
  ['dark', 'omniflow.ocean', '80638366511fba7f9583e4f24c06f37f144bad282b89ac15983ac3358521d95d'],
] as const;

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`Contrast fixture requires an opaque color: ${color}`);
    const channels = [1, 3, 5].map(offset => {
      const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('built-in appearance choices', () => {
  it('keeps Forest as the default while adding Violet as an explicit choice', () => {
    expect(defaultSelection()).toEqual({ mode: 'system', colorThemeId: 'omniflow.default', iconThemeId: 'omniflow.material' });
    expect(BUILT_IN_COLOR_THEMES.map(theme => theme.id)).toEqual(['omniflow.default', 'omniflow.ocean', 'omniflow.violet']);
  });

  it.each(legacyPalettes)('preserves every existing %s color in %s', (mode, id, fingerprint) => {
    const result = resolveAppearanceTheme({ mode, theme: findBuiltInColorTheme(id) });
    const legacyColors = Object.entries(result.colors).filter(([key]) => !addedRoles.has(key as ColorToken)).sort(([a], [b]) => a.localeCompare(b));
    expect(createHash('sha256').update(JSON.stringify(legacyColors)).digest('hex')).toBe(fingerprint);
  });

  it.each(['light', 'dark'] as const)('preserves the historical navigation and Semi selected controls in %s', mode => {
    const colors = resolveAppearanceTheme({ mode }).colors;
    expect(colors['navigation.active']).toBe(mode === 'light' ? '#7850b8' : '#bd9af2');
    expect(colors['accent.foreground']).toBe('#ffffff');
    // Semi 2.83's blue-0/1/2 in light mode, blue-5 at .2/.3/.4 in dark mode.
    expect(toSemiThemeVariables({ colors })).toMatchObject(mode === 'light' ? {
      '--semi-color-primary-light-default': 'rgba(234, 245, 255, 1)',
      '--semi-color-primary-light-hover': 'rgba(203, 231, 254, 1)',
      '--semi-color-primary-light-active': 'rgba(152, 205, 253, 1)',
    } : {
      '--semi-color-primary-light-default': 'rgba(84, 169, 255, 0.2)',
      '--semi-color-primary-light-hover': 'rgba(84, 169, 255, 0.3)',
      '--semi-color-primary-light-active': 'rgba(84, 169, 255, 0.4)',
    });
  });

  it.each(['light', 'dark'] as const)('provides a complete valid Violet palette and coherent selected states in %s', mode => {
    const theme = BUILT_IN_COLOR_THEMES.find(item => item.id === 'omniflow.violet')!;
    expect(Object.keys(theme.variants[mode]).sort()).toEqual(Object.keys(COLOR_CSS_VARIABLES).sort());
    const resolved = resolveAppearanceTheme({ mode, theme: findBuiltInColorTheme(theme.id) });
    expect(resolved.errors).toEqual([]);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.themeId).toBe('omniflow.violet');
    const c = resolved.colors;
    expect(c['navigation.active']).toBe(c['accent.default']);
    expect(c['control.selected.background']).toBe(c['accent.soft']);
    expect(toSemiThemeVariables(resolved)).toMatchObject({
      '--semi-color-primary': c['accent.default'],
      '--semi-color-primary-hover': c['accent.hover'], '--semi-color-primary-active': c['accent.active'],
      '--semi-color-primary-light-default': c['control.selected.background'],
      '--semi-color-primary-light-hover': c['control.selected.hover'], '--semi-color-primary-light-active': c['control.selected.active'],
    });
  });

  it.each(['light', 'dark'] as const)('keeps key Violet text and active controls readable in %s', mode => {
    const c = resolveAppearanceTheme({ mode, theme: findBuiltInColorTheme('omniflow.violet') }).colors;
    const pairs: Array<[ColorToken, ColorToken]> = [
      ['text.primary', 'surface.app'], ['text.primary', 'surface.panel'],
      ['text.secondary', 'surface.app'], ['text.muted', 'surface.panel'],
      ['text.link', 'surface.app'], ['selection.text', 'selection.background'],
      ['accent.foreground', 'accent.default'], ['accent.foreground', 'accent.hover'], ['accent.foreground', 'accent.active'],
      ['accent.default', 'control.selected.background'], ['accent.default', 'control.selected.active'],
      ['folder.archive.label', 'control.selected.background'],
      ['folder.archive.label', 'control.selected.hover'], ['folder.archive.label', 'control.selected.active'],
      ['editor.text', 'editor.background'], ['editor.gutter', 'editor.background'],
      ['syntax.keyword', 'editor.background'], ['syntax.comment', 'editor.background'],
      ['status.danger.text', 'status.danger.background'], ['status.success.text', 'status.success.background'],
      ['status.warning.text', 'status.warning.background'], ['status.info.text', 'status.info.background'],
    ];
    for (const [foreground, background] of pairs) {
      expect(contrast(c[foreground], c[background]), `${mode}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
