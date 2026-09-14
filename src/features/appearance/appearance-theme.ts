import type { ResolvedThemeMode } from '@/contexts/theme.context';
import { COLOR_CSS_VARIABLES, DEFAULT_COLOR_TOKENS, isThemeRecord, validateColorOverrides, validateColorTheme, type ColorToken, type ThemeDiagnostic } from './color-theme';
import { DEFAULT_THEME_EFFECTS, effectsToCss, validateThemeEffects, type EffectOverrides } from './theme-effects';

// Backward compatible with color-only v1: optional effects is keyed by light/dark.
export function resolveAppearanceTheme(input: { mode: ResolvedThemeMode; theme?: unknown; overrides?: unknown }) {
  const { mode } = input;
  if (mode !== 'light' && mode !== 'dark') throw new Error('Expected resolved theme mode');
  const errors: ThemeDiagnostic[] = [];
  const warnings: ThemeDiagnostic[] = [];
  let colorDefinition;
  const effects: Partial<Record<ResolvedThemeMode, EffectOverrides>> = {};
  if (input.theme !== undefined) {
    if (!isThemeRecord(input.theme) || Object.keys(input.theme).some(key => !['schemaVersion', 'id', 'variants', 'effects'].includes(key))) {
      errors.push({ path: 'theme', reason: 'Invalid theme object or unknown top-level field' });
    } else {
      const theme = input.theme;
      const color = validateColorTheme({ schemaVersion: theme.schemaVersion, id: theme.id, variants: theme.variants });
      colorDefinition = color.definition ?? undefined;
      errors.push(...color.errors);
      warnings.push(...color.warnings);
      if (theme.effects !== undefined) {
        if (!isThemeRecord(theme.effects) || Object.keys(theme.effects).length > 2) {
          errors.push({ path: 'effects', reason: 'Expected light/dark effect variants' });
        } else {
          for (const [variant, raw] of Object.entries(theme.effects)) {
            if (variant !== 'light' && variant !== 'dark') errors.push({ path: 'effects', reason: 'Unknown mode' });
            else {
              const parsed = validateThemeEffects(raw, `effects.${variant}`);
              errors.push(...parsed.errors);
              warnings.push(...parsed.warnings);
              if (parsed.value) effects[variant] = parsed.value;
            }
          }
        }
      }
    }
  }
  const themeValid = errors.length === 0;
  const baseColors = Object.freeze({ ...DEFAULT_COLOR_TOKENS[mode], ...(themeValid ? colorDefinition?.variants[mode] : {}) });
  const baseEffects = { ...DEFAULT_THEME_EFFECTS[mode], ...(themeValid ? effects[mode] : {}) };
  const overrideErrors: ThemeDiagnostic[] = [];
  let colors = baseColors;
  let resolvedEffects = baseEffects;
  if (input.overrides !== undefined) {
    if (!isThemeRecord(input.overrides) || Object.keys(input.overrides).some(key => !['colors', 'effects'].includes(key))) {
      overrideErrors.push({ path: 'overrides', reason: 'Expected colors/effects overrides' });
    } else {
      const parsedColors = validateColorOverrides(input.overrides.colors === undefined ? {} : input.overrides.colors);
      const parsedEffects = validateThemeEffects(input.overrides.effects === undefined ? {} : input.overrides.effects, 'overrides.effects');
      overrideErrors.push(...parsedColors.errors, ...parsedEffects.errors);
      warnings.push(...parsedColors.warnings, ...parsedEffects.warnings);
      if (!overrideErrors.length) {
        colors = Object.freeze({ ...baseColors, ...parsedColors.value });
        resolvedEffects = { ...baseEffects, ...parsedEffects.value };
      }
    }
  }
  errors.push(...overrideErrors);
  const cssVariables: Record<string, string> = { ...effectsToCss(resolvedEffects) };
  for (const token of Object.keys(COLOR_CSS_VARIABLES) as ColorToken[]) cssVariables[COLOR_CSS_VARIABLES[token]] = colors[token];
  return Object.freeze({
    themeId: themeValid ? colorDefinition?.id ?? 'omniflow.default' : 'omniflow.default',
    mode, colors, effects: Object.freeze(resolvedEffects), cssVariables: Object.freeze(cssVariables),
    errors: Object.freeze(errors), warnings: Object.freeze(warnings),
  });
}
