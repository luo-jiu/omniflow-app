import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAppearanceTheme } from './appearance-theme';
import { validateThemeEffects } from './theme-effects';
import { toEditorThemePalette, toSemiThemeVariables } from './theme-adapters';

const layer = { x: 0, y: 1, blur: 3, spread: 0, color: '#123456' };
const theme = {
  schemaVersion: 1, id: 'example.ocean',
  variants: { light: { 'surface.app': '#abcdef' }, dark: { 'surface.app': '#123456' } },
  effects: { dark: { 'radius.small': 7, 'shadow.default': [layer] } },
};

describe('bounded appearance theme', () => {
  it('combines defaults, variant and sparse overrides with no mutation', () => {
    const result = resolveAppearanceTheme({ mode: 'dark', theme, overrides: { colors: { 'text.primary': '#fff' }, effects: { 'radius.medium': 12 } } });
    expect(result.errors).toEqual([]);
    expect(result.colors['surface.app']).toBe('#123456');
    expect(result.colors['text.primary']).toBe('#fff');
    expect(result.effects['radius.small']).toBe(7);
    expect(result.effects['radius.medium']).toBe(12);
    expect(result.cssVariables['--app-shadow']).toBe('0px 1px 3px 0px #123456');
    expect(Object.isFrozen(result.effects['shadow.default'][0])).toBe(true);
    expect(theme.effects.dark['radius.small']).toBe(7);
    expect(theme.effects.dark['shadow.default'][0]).not.toBe(result.effects['shadow.default'][0]);
  });
  it('retains legacy color-only v1 and defaults missing effects variants', () => {
    expect(resolveAppearanceTheme({ mode: 'dark', theme: { schemaVersion: 1, id: theme.id, variants: theme.variants } }).errors).toEqual([]);
    const result = resolveAppearanceTheme({ mode: 'light', theme });
    expect(result.effects['radius.small']).toBe(5);
    expect(result.cssVariables['--app-radius-large']).toBe('999px');
  });
  it('rejects the whole package when an inactive effect variant is invalid', () => {
    const invalid = { ...theme, effects: { light: { 'radius.small': -1 }, dark: theme.effects.dark } };
    const result = resolveAppearanceTheme({ mode: 'dark', theme: invalid });
    expect(result.errors).not.toHaveLength(0);
    expect(result.themeId).toBe('omniflow.default');
    expect(result.colors['surface.app']).toBe('#1e1e1e');
    expect(result.effects['radius.small']).toBe(5);
  });
  it('rejects effects as well when a color is invalid', () => {
    const result = resolveAppearanceTheme({ mode: 'dark', theme: { ...theme, variants: { dark: { 'text.primary': 'url(x)' } } } });
    expect(result.effects['radius.small']).toBe(5);
    expect(result.themeId).toBe('omniflow.default');
  });
  it.each([
    { colors: { 'text.primary': '#123' }, effects: { 'radius.small': -1 } },
    { colors: { 'text.primary': 'url(x)' }, effects: { 'radius.small': 10 } },
    { effects: null }, { css: 'body{}' }, [],
  ])('rejects a user transaction atomically: %j', overrides => {
    const base = resolveAppearanceTheme({ mode: 'dark', theme });
    const result = resolveAppearanceTheme({ mode: 'dark', theme, overrides });
    expect(result.errors).not.toHaveLength(0);
    expect(result.colors).toEqual(base.colors);
    expect(result.effects).toEqual(base.effects);
  });
  it.each([
    '0 1px 3px red', [layer, layer, layer, layer], [{ ...layer, blur: 65 }], [{ ...layer, x: -33 }],
    [{ ...layer, y: Infinity }], [{ ...layer, spread: NaN }], [{ ...layer, color: 'var(--x)' }],
    [{ ...layer, inset: true }], [{ ...layer, spread: '0' }],
  ])('rejects unsafe or unbounded shadows: %j', raw => {
    expect(validateThemeEffects({ 'shadow.default': raw }).value).toBeNull();
  });
  it.each([-1, 25, 999, '24px', 'pill', NaN, Infinity])('restricts the small radius: %s', raw => {
    expect(validateThemeEffects({ 'radius.small': raw }).value).toBeNull();
  });
  it('supports no shadow, bounded fractional numbers and the explicit pill value', () => {
    const result = resolveAppearanceTheme({ mode: 'light', overrides: { effects: { 'shadow.default': [], 'radius.small': 2.5, 'radius.large': 'pill' } } });
    expect(result.errors).toEqual([]);
    expect(result.cssVariables['--app-shadow']).toBe('none');
    expect(result.cssVariables['--app-radius-small']).toBe('2.5px');
    expect(result.cssVariables['--app-radius-large']).toBe('999px');
  });
  it('ignores unknown effect keys with bounded diagnostics and no prototype copying', () => {
    const effects = JSON.parse('{"__proto__":"#fff","future.radius":10,"radius.small":4}');
    const parsed = validateThemeEffects(effects);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
    expect(Object.keys(parsed.value!)).toEqual(['radius.small']);
  });
  it('rejects invalid envelopes and oversized effect maps', () => {
    for (const input of [null, [], { ...theme, css: 'body{}' }, { ...theme, effects: { system: {} } }, { ...theme, effects: null }]) {
      expect(resolveAppearanceTheme({ mode: 'dark', theme: input }).themeId).toBe('omniflow.default');
    }
    expect(validateThemeEffects(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`x${i}`, 1]))).value).toBeNull();
  });
  it('projects the resolved values into Semi and editor palettes', () => {
    const result = resolveAppearanceTheme({ mode: 'dark', overrides: { colors: { 'accent.hover': '#123456', 'syntax.keyword': '#abcdef' } } });
    expect(toSemiThemeVariables(result)['--semi-color-primary-hover']).toBe('#123456');
    expect(toEditorThemePalette(result).syntax.keyword).toBe('#abcdef');
    expect(toEditorThemePalette(result).dark).toBe(true);
  });
  it('preserves the pre-integration reset palette in both modes', () => {
    const css = readFileSync(new URL('../../assets/css/reset.less', import.meta.url), 'utf8');
    const light = /:root\s*\{([^}]+)\}/.exec(css)![1];
    const dark = /body\[theme-mode="dark"\]\s*\{([^}]+)\}/.exec(css)![1];
    for (const mode of ['light', 'dark'] as const) {
      const declarations = Object.fromEntries([...`${light}\n${mode === 'dark' ? dark : ''}`.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
      const result = resolveAppearanceTheme({ mode });
      for (const [key, value] of Object.entries(result.cssVariables)) {
        if (declarations[key] && !key.includes('shadow')) expect(value, `${mode}/${key}`).toBe(declarations[key]);
      }
      for (const [key, value] of Object.entries(toSemiThemeVariables(result))) {
        const original = declarations[key];
        if (original && !original.startsWith('var(')) expect(value, `${mode}/${key}`).toBe(original);
      }
      expect(result.effects['shadow.default'][0]).toEqual({ x: 0, y: 1, blur: mode === 'dark' ? 4 : 3, spread: 0, color: mode === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.06)' });
    }
  });
});
