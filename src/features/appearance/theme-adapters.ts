import type { resolveAppearanceTheme } from './appearance-theme';

type ResolvedAppearance = ReturnType<typeof resolveAppearanceTheme>;

// Pure projections. Applying them and owning the current snapshot stays with the host.
export function toSemiThemeVariables(theme: Pick<ResolvedAppearance, 'colors'>): Readonly<Record<string, string>> {
  const c = theme.colors;
  return Object.freeze({
    '--semi-color-bg-0': c['surface.app'], '--semi-color-bg-1': c['surface.panel'], '--semi-color-bg-2': c['surface.raised'],
    // Semi's dropdowns, popovers (including arrows), date panels and feedback
    // consume bg-3; its neutral/avatar tags consume bg-4.
    '--semi-color-bg-3': c['surface.popover'], '--semi-color-bg-4': c['surface.elevated'],
    '--semi-color-fill-0': c['fill.subtle'], '--semi-color-fill-1': c['fill.default'], '--semi-color-fill-2': c['fill.strong'], '--semi-color-fill-3': c['fill.pressed'],
    '--semi-color-text-0': c['text.primary'], '--semi-color-text-1': c['text.secondary'], '--semi-color-text-2': c['text.muted'], '--semi-color-text-3': c['text.disabled'],
    // Disabled controls use this separate family, not text-3 / fill-0 directly.
    '--semi-color-disabled-text': c['text.disabled'], '--semi-color-disabled-border': c['border.default'],
    '--semi-color-disabled-bg': c['fill.default'], '--semi-color-disabled-fill': c['fill.subtle'],
    '--semi-color-border': c['border.default'], '--semi-color-link': c['text.link'], '--semi-color-focus-border': c['focus.border'],
    '--semi-color-primary': c['accent.default'], '--semi-color-primary-hover': c['accent.hover'], '--semi-color-primary-active': c['accent.active'],
    '--semi-color-primary-light-default': c['control.selected.background'],
    '--semi-color-primary-light-hover': c['control.selected.hover'], '--semi-color-primary-light-active': c['control.selected.active'],
    '--semi-color-success': c['status.success.text'], '--semi-color-success-light-default': c['status.success.background'],
    '--semi-color-warning': c['status.warning.text'], '--semi-color-warning-light-default': c['status.warning.background'],
    '--semi-color-danger': c['status.danger.text'], '--semi-color-danger-light-default': c['status.danger.background'],
    '--semi-color-info': c['status.info.text'], '--semi-color-info-light-default': c['status.info.background'],
  });
}

export function toEditorThemePalette(theme: ResolvedAppearance) {
  const c = theme.colors;
  return Object.freeze({
    dark: theme.mode === 'dark',
    background: c['editor.background'], foreground: c['editor.text'],
    gutter: c['editor.gutter'], cursor: c['editor.cursor'], selection: c['editor.selection'], activeLine: c['editor.activeLine'],
    syntax: Object.freeze({
      keyword: c['syntax.keyword'], string: c['syntax.string'], number: c['syntax.number'], comment: c['syntax.comment'],
      function: c['syntax.function'], type: c['syntax.type'], operator: c['syntax.operator'], invalid: c['syntax.invalid'],
    }),
  });
}
