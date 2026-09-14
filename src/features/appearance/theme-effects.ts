import type { ResolvedThemeMode } from '@/contexts/theme.context';
import { isThemeColor, isThemeRecord, type ThemeDiagnostic } from './color-theme';

export const EFFECT_CSS_VARIABLES = Object.freeze({
  'shadow.default': '--app-shadow',
  'shadow.soft': '--app-shadow-soft',
  'radius.small': '--app-radius-small',
  'radius.medium': '--app-radius-medium',
  'radius.large': '--app-radius-large',
} as const);
export interface ShadowLayer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
}
export interface ThemeEffects {
  readonly 'shadow.default': readonly ShadowLayer[];
  readonly 'shadow.soft': readonly ShadowLayer[];
  readonly 'radius.small': number;
  readonly 'radius.medium': number;
  readonly 'radius.large': number | 'pill';
}
export type EffectToken = keyof ThemeEffects;
export type EffectOverrides = Readonly<Partial<ThemeEffects>>;

function defaultEffects(mode: ResolvedThemeMode): ThemeEffects {
  const dark = mode === 'dark';
  const layer = (blur: number, alpha: number) => Object.freeze([
    Object.freeze({ x: 0, y: 1, blur, spread: 0, color: `rgba(0, 0, 0, ${alpha})` }),
  ]);
  return Object.freeze({
    'shadow.default': layer(dark ? 4 : 3, dark ? 0.3 : 0.06),
    'shadow.soft': layer(2, dark ? 0.2 : 0.04),
    'radius.small': 5, 'radius.medium': 10, 'radius.large': 'pill',
  });
}
export const DEFAULT_THEME_EFFECTS = Object.freeze({ light: defaultEffects('light'), dark: defaultEffects('dark') });

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function parseShadow(value: unknown): readonly ShadowLayer[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const layers: ShadowLayer[] = [];
  for (const item of value) {
    if (!isThemeRecord(item) || Object.keys(item).length !== 5
      || !boundedNumber(item.x, -32, 32) || !boundedNumber(item.y, -32, 32)
      || !boundedNumber(item.blur, 0, 64) || !boundedNumber(item.spread, -16, 16)
      || !isThemeColor(item.color)) return null;
    layers.push(Object.freeze({ x: item.x, y: item.y, blur: item.blur, spread: item.spread, color: item.color }));
  }
  return Object.freeze(layers);
}

export function validateThemeEffects(input: unknown, path = 'effects') {
  const errors: ThemeDiagnostic[] = [];
  const warnings: ThemeDiagnostic[] = [];
  const value: Partial<ThemeEffects> = {};
  if (!isThemeRecord(input) || Object.keys(input).length > 256) {
    return { value: null, errors: [{ path, reason: 'Expected at most 256 effect entries' }], warnings };
  }
  for (const [key, raw] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(EFFECT_CSS_VARIABLES, key)) {
      warnings.push({ path: `${path}.${key.slice(0, 128)}`, reason: 'Unknown effect ignored' });
    } else if (key === 'shadow.default' || key === 'shadow.soft') {
      const shadow = parseShadow(raw);
      if (!shadow) errors.push({ path: `${path}.${key}`, reason: 'Invalid bounded shadow layers' });
      else Object.assign(value, { [key]: shadow });
    } else if (boundedNumber(raw, 0, 24) || (key === 'radius.large' && raw === 'pill')) {
      Object.assign(value, { [key]: raw });
    } else errors.push({ path: `${path}.${key}`, reason: 'Radius must be 0..24; only large permits pill' });
  }
  return { value: errors.length ? null : Object.freeze(value), errors, warnings };
}

// Call only on resolved, validated effects. No untrusted CSS strings are concatenated.
export function effectsToCss(effects: ThemeEffects): Readonly<Record<string, string>> {
  const shadow = (layers: readonly ShadowLayer[]) => layers.length
    ? layers.map(layer => `${layer.x}px ${layer.y}px ${layer.blur}px ${layer.spread}px ${layer.color}`).join(', ')
    : 'none';
  return Object.freeze({
    '--app-shadow': shadow(effects['shadow.default']),
    '--app-shadow-soft': shadow(effects['shadow.soft']),
    '--app-radius-small': `${effects['radius.small']}px`,
    '--app-radius-medium': `${effects['radius.medium']}px`,
    '--app-radius-large': effects['radius.large'] === 'pill' ? '999px' : `${effects['radius.large']}px`,
  });
}
