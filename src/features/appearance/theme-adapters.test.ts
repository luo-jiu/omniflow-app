import { describe, expect, it } from 'vitest';
import { resolveAppearanceTheme } from './appearance-theme';
import { findBuiltInColorTheme } from './built-in-themes';
import { toSemiThemeVariables } from './theme-adapters';
import { themeViewVariables } from './theme-view';

describe('Semi foundation theme projection', () => {
  it.each([
    ['omniflow.default', 'light'], ['omniflow.default', 'dark'],
    ['omniflow.ocean', 'light'], ['omniflow.ocean', 'dark'],
    ['omniflow.violet', 'light'], ['omniflow.violet', 'dark'],
  ] as const)('uses shared surface, input and disabled roles for %s in %s', (id, mode) => {
    const resolved = resolveAppearanceTheme({ mode, theme: findBuiltInColorTheme(id) });
    const c = resolved.colors;
    expect(toSemiThemeVariables(resolved)).toMatchObject({
      '--semi-color-bg-3': c['surface.popover'],
      '--semi-color-bg-4': c['surface.elevated'],
      '--semi-color-disabled-text': c['text.disabled'],
      '--semi-color-disabled-border': c['border.default'],
      '--semi-color-disabled-bg': c['fill.default'],
      '--semi-color-disabled-fill': c['fill.subtle'],
      // Semi Input consumes fill / text / focus directly; it has no input token.
      '--semi-color-fill-0': c['fill.subtle'],
      '--semi-color-fill-1': c['fill.default'],
      '--semi-color-fill-2': c['fill.strong'],
      '--semi-color-text-0': c['text.primary'],
      '--semi-color-text-2': c['text.muted'],
      '--semi-color-focus-border': c['focus.border'],
    });
  });

  it('publishes independently overridden surfaces and disabled roles through the shared DOM projection', () => {
    const resolved = resolveAppearanceTheme({ mode: 'dark', overrides: { colors: {
      'surface.popover': '#111122', 'surface.elevated': '#222233',
      'text.disabled': '#aabbcc', 'border.default': '#334455',
      'fill.default': '#445566', 'fill.subtle': '#556677',
    } } });
    const variables = themeViewVariables({ schemaVersion: 1, ownerEpoch: 'semi-projection', revision: 1,
      source: 'dark', mode: 'dark', iconThemeId: 'omniflow.material', colors: resolved.colors, effects: resolved.effects });
    expect(variables).toMatchObject({
      '--semi-color-bg-3': '#111122', '--app-bg-popover': '#111122',
      '--semi-color-bg-4': '#222233', '--app-bg-elevated': '#222233',
      '--semi-color-disabled-text': '#aabbcc', '--app-text-disabled': '#aabbcc',
      '--semi-color-disabled-border': '#334455', '--app-border': '#334455',
      '--semi-color-disabled-bg': '#445566', '--app-fill-default': '#445566',
      '--semi-color-disabled-fill': '#556677', '--app-fill-subtle': '#556677',
    });
  });
});
