import { COLOR_CSS_VARIABLES, validateColorOverrides, type ColorTokens, isThemeRecord } from './color-theme';
import { EFFECT_CSS_VARIABLES, validateThemeEffects, effectsToCss, type ThemeEffects } from './theme-effects';
import type { ResolvedThemeMode, ThemeMode } from '@/contexts/theme.context';
import type { ThemeSnapshot } from './theme-state';
import { toSemiThemeVariables } from './theme-adapters';

export interface ThemeView {
  schemaVersion: 1;
  ownerEpoch: string;
  revision: number;
  mode: ResolvedThemeMode;
  source: ThemeMode;
  iconThemeId: string;
  colors: ColorTokens;
  effects: ThemeEffects;
}
export function toThemeView(snapshot: ThemeSnapshot): ThemeView {
  return { schemaVersion: 1, ownerEpoch: snapshot.ownerEpoch, revision: snapshot.revision,
    source: snapshot.requested.mode, mode: snapshot.resolved.mode, iconThemeId: snapshot.requested.iconThemeId,
    colors: snapshot.resolved.colors, effects: snapshot.resolved.effects };
}
export function validateThemeView(value: unknown): ThemeView | null {
  if (!isThemeRecord(value) || value.schemaVersion !== 1 || typeof value.ownerEpoch !== 'string' || !value.ownerEpoch || value.ownerEpoch.length > 128
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !['light', 'dark'].includes(String(value.mode))
    || !['light', 'dark', 'system'].includes(String(value.source)) || typeof value.iconThemeId !== 'string' || value.iconThemeId.length > 128) return null;
  const colors = validateColorOverrides(value.colors);
  const effects = validateThemeEffects(value.effects);
  if (!colors.value || !effects.value || colors.warnings.length || effects.warnings.length
    || Object.keys(colors.value).length !== Object.keys(COLOR_CSS_VARIABLES).length
    || Object.keys(effects.value).length !== Object.keys(EFFECT_CSS_VARIABLES).length) return null;
  return { schemaVersion: 1, ownerEpoch: value.ownerEpoch, revision: Number(value.revision), source: value.source as ThemeMode,
    mode: value.mode as ResolvedThemeMode, iconThemeId: value.iconThemeId, colors: colors.value as ColorTokens, effects: effects.value as ThemeEffects };
}
export function themeViewVariables(view: ThemeView) {
  const variables: Record<string, string> = { ...effectsToCss(view.effects), ...toSemiThemeVariables({ colors: view.colors }) };
  for (const key of Object.keys(COLOR_CSS_VARIABLES) as Array<keyof ColorTokens>) variables[COLOR_CSS_VARIABLES[key]] = view.colors[key];
  return variables;
}
