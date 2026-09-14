// Internal A1 contract. Not a published plugin SDK or an activation API.
import type { ResolvedThemeMode } from '@/contexts/theme.context';

export const COLOR_CSS_VARIABLES = Object.freeze({
  'surface.app': '--app-bg',
  'surface.sidebar': '--app-bg-sidebar',
  'surface.sidebarVibrancy': '--app-sidebar-vibrancy',
  'surface.elevated': '--app-bg-elevated',
  'surface.panel': '--app-panel',
  'surface.muted': '--app-panel-muted',
  'border.default': '--app-border',
  'border.strong': '--app-border-strong',
  'text.primary': '--app-text',
  'text.secondary': '--app-text-secondary',
  'text.muted': '--app-text-muted',
  'accent.default': '--app-accent',
  'accent.soft': '--app-accent-soft',
  'accent.hover': '--app-accent-hover',
  'accent.active': '--app-accent-active',
  'scrollbar.thumb': '--app-scrollbar-thumb',
  'scrollbar.hover': '--app-scrollbar-thumb-hover',
  'scrollbar.track': '--app-scrollbar-track',
  'selection.background': '--app-selection-bg',
  'focus.border': '--app-focus-border',
  'text.disabled': '--app-text-disabled',
  'status.danger.text': '--app-danger-text',
  'status.danger.background': '--app-danger-bg',
  'status.danger.border': '--app-danger-border',
  'folder.archive.label': '--app-folder-archive-label',
  'surface.input': '--app-bg-input',
  'surface.popover': '--app-bg-popover',
  'surface.raised': '--app-bg-raised',
  'fill.subtle': '--app-fill-subtle',
  'fill.default': '--app-fill-default',
  'fill.strong': '--app-fill-strong',
  'fill.pressed': '--app-fill-pressed',
  'interaction.hover': '--app-hover-bg',
  'interaction.active': '--app-active-bg',
  'selection.text': '--app-selection-text',
  'text.link': '--app-link',
  'status.success.text': '--app-success-text',
  'status.success.background': '--app-success-bg',
  'status.success.border': '--app-success-border',
  'status.warning.text': '--app-warning-text',
  'status.warning.background': '--app-warning-bg',
  'status.warning.border': '--app-warning-border',
  'status.info.text': '--app-info-text',
  'status.info.background': '--app-info-bg',
  'status.info.border': '--app-info-border',
  'folder.default.label': '--app-folder-label',
  'folder.media.label': '--app-folder-media-label',
  'folder.unknown.label': '--app-folder-unknown-label',
  'editor.background': '--app-editor-bg',
  'editor.text': '--app-editor-text',
  'editor.gutter': '--app-editor-gutter',
  'editor.cursor': '--app-editor-cursor',
  'editor.selection': '--app-editor-selection',
  'editor.activeLine': '--app-editor-active-line',
  'syntax.keyword': '--app-syntax-keyword',
  'syntax.string': '--app-syntax-string',
  'syntax.number': '--app-syntax-number',
  'syntax.comment': '--app-syntax-comment',
  'syntax.function': '--app-syntax-function',
  'syntax.type': '--app-syntax-type',
  'syntax.operator': '--app-syntax-operator',
  'syntax.invalid': '--app-syntax-invalid',
} as const);

export type ColorToken = keyof typeof COLOR_CSS_VARIABLES;
export type ColorTokens = Readonly<Record<ColorToken, string>>;
export type ColorTokenOverrides = Readonly<Partial<Record<ColorToken, string>>>;
export interface ColorThemeDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly variants: Readonly<Partial<Record<ResolvedThemeMode, ColorTokenOverrides>>>;
}
export interface ThemeDiagnostic { readonly path: string; readonly reason: string }
export interface ColorThemeValidation {
  readonly definition: ColorThemeDefinition | null;
  readonly errors: readonly ThemeDiagnostic[];
  readonly warnings: readonly ThemeDiagnostic[];
}

const light: ColorTokens = Object.freeze({
  'surface.app': '#f5f5f0', 'surface.sidebar': '#ededea', 'surface.sidebarVibrancy': 'rgba(245, 245, 240, 0.08)',
  'surface.elevated': '#ffffff', 'surface.panel': '#ffffff', 'surface.muted': '#f0f0ec',
  'border.default': 'rgba(0, 0, 0, 0.06)', 'border.strong': 'rgba(0, 0, 0, 0.1)',
  'text.primary': '#1a1a1a', 'text.secondary': '#6b6b6b', 'text.muted': '#999999',
  'accent.default': '#345847', 'accent.soft': 'rgba(52, 88, 71, 0.08)', 'accent.hover': '#284738', 'accent.active': '#1f382c',
  'scrollbar.thumb': 'rgba(0, 0, 0, 0.18)', 'scrollbar.hover': 'rgba(0, 0, 0, 0.28)', 'scrollbar.track': 'transparent',
  'selection.background': 'rgba(52, 88, 71, 0.12)', 'focus.border': '#345847', 'text.disabled': '#767676',
  'status.danger.text': '#b42318', 'status.danger.background': '#fef3f2', 'status.danger.border': '#fecdca',
  'folder.archive.label': '#3f7355',
  'surface.input': '#ffffff',
  'surface.popover': '#ffffff',
  'surface.raised': '#eaeae6',
  'fill.subtle': '#f0f0ec',
  'fill.default': '#eaeae6',
  'fill.strong': '#e0e0dc',
  'fill.pressed': '#d5d5d0',
  'interaction.hover': 'rgba(0, 0, 0, 0.04)',
  'interaction.active': 'rgba(0, 0, 0, 0.08)',
  'selection.text': '#1a1a1a',
  'text.link': '#345847',
  'status.success.text': '#176b3a',
  'status.success.background': '#edf9f0',
  'status.success.border': '#a8d9b7',
  'status.warning.text': '#854d0e',
  'status.warning.background': '#fff8e6',
  'status.warning.border': '#ecd099',
  'status.info.text': '#175cd3',
  'status.info.background': '#eff6ff',
  'status.info.border': '#b2ccff',
  'folder.default.label': '#1a1a1a',
  'folder.media.label': '#345847',
  'folder.unknown.label': '#854d0e',
  'editor.background': '#ffffff',
  'editor.text': '#24292e',
  'editor.gutter': '#6b6b6b',
  'editor.cursor': '#24292e',
  'editor.selection': '#b3d7ff',
  'editor.activeLine': '#f5f7fa',
  'syntax.keyword': '#a626a4',
  'syntax.string': '#267f42',
  'syntax.number': '#986801',
  'syntax.comment': '#626b77',
  'syntax.function': '#4078f2',
  'syntax.type': '#986801',
  'syntax.operator': '#0184bc',
  'syntax.invalid': '#b42318',
});
const dark: ColorTokens = Object.freeze({
  'surface.app': '#1e1e1e', 'surface.sidebar': '#252525', 'surface.sidebarVibrancy': 'rgba(30, 30, 30, 0.2)',
  'surface.elevated': '#2a2a2a', 'surface.panel': '#2a2a2a', 'surface.muted': '#333333',
  'border.default': 'rgba(255, 255, 255, 0.08)', 'border.strong': 'rgba(255, 255, 255, 0.14)',
  'text.primary': '#e8e8e8', 'text.secondary': '#aaaaaa', 'text.muted': '#777777',
  'accent.default': '#5a9e7c', 'accent.soft': 'rgba(90, 158, 124, 0.12)', 'accent.hover': '#4a8a6a', 'accent.active': '#3d7a5c',
  'scrollbar.thumb': 'rgba(255, 255, 255, 0.28)', 'scrollbar.hover': 'rgba(255, 255, 255, 0.38)', 'scrollbar.track': 'transparent',
  'selection.background': 'rgba(90, 158, 124, 0.18)', 'focus.border': '#5a9e7c', 'text.disabled': '#909090',
  'status.danger.text': '#fda29b', 'status.danger.background': '#3b1d1b', 'status.danger.border': '#914039',
  'folder.archive.label': '#83bd91',
  'surface.input': '#2a2a2a',
  'surface.popover': '#2a2a2a',
  'surface.raised': '#333333',
  'fill.subtle': '#2e2e2e',
  'fill.default': '#363636',
  'fill.strong': '#404040',
  'fill.pressed': '#4a4a4a',
  'interaction.hover': 'rgba(255, 255, 255, 0.06)',
  'interaction.active': 'rgba(255, 255, 255, 0.12)',
  'selection.text': '#e8e8e8',
  'text.link': '#5a9e7c',
  'status.success.text': '#75d6a0',
  'status.success.background': '#172f23',
  'status.success.border': '#386b4b',
  'status.warning.text': '#facc70',
  'status.warning.background': '#332a17',
  'status.warning.border': '#75613b',
  'status.info.text': '#84adff',
  'status.info.background': '#18273f',
  'status.info.border': '#3b5685',
  'folder.default.label': '#e8e8e8',
  'folder.media.label': '#5a9e7c',
  'folder.unknown.label': '#facc70',
  'editor.background': '#282c34',
  'editor.text': '#abb2bf',
  'editor.gutter': '#9da5b4',
  'editor.cursor': '#abb2bf',
  'editor.selection': '#3e4451',
  'editor.activeLine': '#2c313a',
  'syntax.keyword': '#c678dd',
  'syntax.string': '#98c379',
  'syntax.number': '#d19a66',
  'syntax.comment': '#939caa',
  'syntax.function': '#61afef',
  'syntax.type': '#e5c07b',
  'syntax.operator': '#56b6c2',
  'syntax.invalid': '#fda29b',
});
export const DEFAULT_COLOR_TOKENS: Readonly<Record<ResolvedThemeMode, ColorTokens>> = Object.freeze({ light, dark });

export function isThemeRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Intentionally narrow grammar: no CSS functions with expressions, variables or URLs.
export function isThemeColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || value.trim() !== value) return false;
  if (value === 'transparent' || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return true;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  if (rgb) return rgb.slice(1).every(component => Number(component) <= 255);
  const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/.exec(value);
  return Boolean(rgba && rgba.slice(1, 4).every(component => Number(component) <= 255));
}

function parseTokens(value: unknown, path: string, errors: ThemeDiagnostic[], warnings: ThemeDiagnostic[]) {
  const result: Partial<Record<ColorToken, string>> = {};
  if (!isThemeRecord(value) || Object.keys(value).length > 256) {
    errors.push({ path, reason: 'Expected a token object with at most 256 entries' });
    return Object.freeze(result);
  }
  for (const [key, color] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(COLOR_CSS_VARIABLES, key)) {
      warnings.push({ path: `${path}.${key.slice(0, 128)}`, reason: 'Unknown token ignored' });
    } else if (!isThemeColor(color)) {
      errors.push({ path: `${path}.${key}`, reason: 'Invalid color' });
    } else {
      result[key as ColorToken] = color;
    }
  }
  return Object.freeze(result);
}

export function validateColorTheme(input: unknown): ColorThemeValidation {
  const errors: ThemeDiagnostic[] = [];
  const warnings: ThemeDiagnostic[] = [];
  if (!isThemeRecord(input) || input.schemaVersion !== 1 || typeof input.id !== 'string'
    || input.id.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(input.id)
    || !isThemeRecord(input.variants)) {
    return { definition: null, errors: [{ path: 'theme', reason: 'Invalid schema, id or variants' }], warnings };
  }
  for (const key of Object.keys(input)) {
    if (!['schemaVersion', 'id', 'variants'].includes(key)) errors.push({ path: `theme.${key.slice(0, 128)}`, reason: 'Unknown field' });
  }
  const variants: Partial<Record<ResolvedThemeMode, ColorTokenOverrides>> = {};
  const modes = Object.keys(input.variants);
  if (modes.length === 0 || modes.length > 2) errors.push({ path: 'variants', reason: 'Expected one or two variants' });
  for (const mode of modes) {
    if (mode !== 'light' && mode !== 'dark') errors.push({ path: `variants.${mode.slice(0, 128)}`, reason: 'Unknown mode' });
    else variants[mode] = parseTokens(input.variants[mode], `variants.${mode}`, errors, warnings);
  }
  return {
    definition: errors.length ? null : Object.freeze({ schemaVersion: 1 as const, id: input.id, variants: Object.freeze(variants) }),
    errors, warnings,
  };
}

export function validateColorOverrides(input: unknown) {
  const errors: ThemeDiagnostic[] = [];
  const warnings: ThemeDiagnostic[] = [];
  const value = parseTokens(input, 'overrides.colors', errors, warnings);
  return { value: errors.length ? null : value, errors, warnings };
}

export function resolveColorTheme(input: { mode: ResolvedThemeMode; theme?: unknown; overrides?: unknown }) {
  if (input.mode !== 'light' && input.mode !== 'dark') throw new Error('Expected resolved theme mode');
  const validation = input.theme === undefined ? null : validateColorTheme(input.theme);
  const errors: ThemeDiagnostic[] = [];
  const warnings: ThemeDiagnostic[] = [];
  const overrides = input.overrides === undefined ? {} : parseTokens(input.overrides, 'overrides', errors, warnings);
  // Bad overrides are atomic too: retain the valid theme, apply no partial override.
  return Object.freeze({
    themeId: validation?.definition?.id ?? 'omniflow.default',
    mode: input.mode,
    tokens: Object.freeze({ ...DEFAULT_COLOR_TOKENS[input.mode], ...validation?.definition?.variants[input.mode], ...(errors.length ? {} : overrides) }),
    errors: Object.freeze([...(validation?.errors ?? []), ...errors]),
    warnings: Object.freeze([...(validation?.warnings ?? []), ...warnings]),
  });
}
