import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR_TOKENS, isThemeColor, resolveColorTheme, validateColorTheme } from './color-theme';

const theme = { schemaVersion: 1, id: 'example.ocean', variants: { dark: { 'surface.app': '#001122' } } };
describe('color theme parsing boundary', () => {
  it('applies defaults, mode variant, then user overrides without mutating input', () => {
    const result = resolveColorTheme({ mode: 'dark', theme, overrides: { 'surface.app': '#123456' } });
    expect(result.tokens['surface.app']).toBe('#123456');
    expect(result.tokens['text.primary']).toBe('#e8e8e8');
    expect(theme.variants.dark['surface.app']).toBe('#001122');
    expect(Object.isFrozen(result.tokens)).toBe(true);
  });
  it('falls back to mode defaults when the theme lacks that variant', () => {
    expect(resolveColorTheme({ mode: 'light', theme }).tokens).toEqual(DEFAULT_COLOR_TOKENS.light);
  });
  it.each(['url(https://example.invalid)', 'var(--secret)', '#fff;display:none', 'rgb(256,0,0)', 'rgba(0,0,0,1.1)', 'currentColor', ' #fff', 'red', 'hsl(0,0%,0%)'])('rejects non-contract color %s', color => {
    expect(isThemeColor(color)).toBe(false);
  });
  it.each(['#fff', '#abcd', '#112233', '#11223344', 'rgb(255, 0, 1)', 'rgba(0, 0, 0, 0.08)', 'transparent'])('accepts bounded color %s', color => {
    expect(isThemeColor(color)).toBe(true);
  });
  it('validates every built-in default', () => {
    for (const variant of Object.values(DEFAULT_COLOR_TOKENS)) for (const color of Object.values(variant)) expect(isThemeColor(color)).toBe(true);
  });
  it('rejects the whole theme when an inactive variant contains an invalid known token', () => {
    const invalid = { ...theme, variants: { ...theme.variants, light: { 'text.primary': 'url(x)' } } };
    const result = resolveColorTheme({ mode: 'dark', theme: invalid });
    expect(result.themeId).toBe('omniflow.default');
    expect(result.tokens).toEqual(DEFAULT_COLOR_TOKENS.dark);
    expect(result.errors).toHaveLength(1);
  });
  it('ignores unknown tokens with diagnostics and never copies prototype keys', () => {
    const parsed = JSON.parse('{"schemaVersion":1,"id":"example.safe","variants":{"light":{"__proto__":"#fff","future.token":"#fff","text.primary":"#123"}}}');
    const result = resolveColorTheme({ mode: 'light', theme: parsed });
    expect(result.warnings).toHaveLength(2);
    expect(Object.prototype.hasOwnProperty.call(result.tokens, '__proto__')).toBe(false);
    expect(result.tokens['text.primary']).toBe('#123');
  });
  it('rejects invalid overrides atomically without discarding a valid theme', () => {
    const result = resolveColorTheme({ mode: 'dark', theme, overrides: { 'text.primary': '#123', 'surface.app': 'url(x)' } });
    expect(result.themeId).toBe('example.ocean');
    expect(result.tokens['text.primary']).toBe(DEFAULT_COLOR_TOKENS.dark['text.primary']);
    expect(result.tokens['surface.app']).toBe('#001122');
  });
  it('rejects unsupported versions, malformed IDs, variants and oversized maps', () => {
    for (const input of [null, [], { ...theme, schemaVersion: 2 }, { ...theme, id: '../theme' }, { ...theme, variants: {} }, { ...theme, variants: { system: {} } }, { ...theme, script: 'run' }, { ...theme, variants: { light: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`x${i}`, '#fff'])) } }]) {
      expect(validateColorTheme(input).definition).toBeNull();
    }
  });
});
