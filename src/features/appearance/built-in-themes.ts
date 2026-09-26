import type { ColorTokens } from './color-theme';

// Keep this theme complete: additions to the host contract must be designed for both modes.
const violet = {
  light: {
    // Keep the workspace neutral; violet is reserved for semantic emphasis below.
    'surface.app': '#f5f5f0', 'surface.sidebar': '#ededea', 'surface.sidebarVibrancy': 'rgba(245, 245, 240, 0.08)',
    'surface.elevated': '#ffffff', 'surface.panel': '#ffffff', 'surface.muted': '#f0f0ec',
    'surface.input': '#ffffff', 'surface.popover': '#ffffff', 'surface.raised': '#eaeae6',
    'fill.subtle': '#f0f0ec', 'fill.default': '#eaeae6', 'fill.strong': '#e0e0dc', 'fill.pressed': '#d5d5d0',
    'border.default': 'rgba(0, 0, 0, 0.06)', 'border.strong': 'rgba(0, 0, 0, 0.1)',
    'text.primary': '#202020', 'text.secondary': '#484848', 'text.muted': '#666666', 'text.disabled': '#969696',
    'text.link': '#7546ae',
    'accent.default': '#7546ae', 'accent.soft': '#eee4fa', 'accent.hover': '#633790', 'accent.active': '#522975',
    'accent.foreground': '#ffffff', 'navigation.active': '#7546ae',
    'control.selected.background': '#eee4fa', 'control.selected.hover': '#ebe0f8', 'control.selected.active': '#e5d2f3',
    'scrollbar.thumb': 'rgba(0, 0, 0, 0.18)', 'scrollbar.hover': 'rgba(0, 0, 0, 0.28)', 'scrollbar.track': 'transparent',
    'interaction.hover': 'rgba(0, 0, 0, 0.04)', 'interaction.active': 'rgba(0, 0, 0, 0.08)',
    'selection.background': '#e0cdf5', 'selection.text': '#2c2436', 'focus.border': '#7546ae',
    'status.danger.text': '#ab293e', 'status.danger.background': '#fff0f2', 'status.danger.border': '#efb6c0',
    'status.success.text': '#216b47', 'status.success.background': '#edf8f1', 'status.success.border': '#add6bd',
    'status.warning.text': '#835314', 'status.warning.background': '#fff7e8', 'status.warning.border': '#e5cc9d',
    'status.info.text': '#345b9b', 'status.info.background': '#eff4ff', 'status.info.border': '#becdeb',
    'folder.default.label': '#252525', 'folder.media.label': '#7546ae', 'folder.unknown.label': '#835314', 'folder.archive.label': '#7546ae',
    'editor.background': '#ffffff', 'editor.text': '#24292e', 'editor.gutter': '#6b6b6b', 'editor.cursor': '#7546ae',
    'editor.selection': '#e0cdf5', 'editor.activeLine': '#f5f7fa',
    'syntax.keyword': '#7546ae', 'syntax.string': '#256d50', 'syntax.number': '#94601d', 'syntax.comment': '#746780',
    'syntax.function': '#385da6', 'syntax.type': '#8e4e85', 'syntax.operator': '#526394', 'syntax.invalid': '#ab293e',
  },
  dark: {
    // Keep the workspace neutral; violet remains visible in semantic states.
    'surface.app': '#1e1e1e', 'surface.sidebar': '#252525', 'surface.sidebarVibrancy': 'rgba(30, 30, 30, 0.2)',
    'surface.elevated': '#2a2a2a', 'surface.panel': '#2a2a2a', 'surface.muted': '#333333',
    'surface.input': '#2a2a2a', 'surface.popover': '#2a2a2a', 'surface.raised': '#333333',
    'fill.subtle': '#2e2e2e', 'fill.default': '#363636', 'fill.strong': '#404040', 'fill.pressed': '#4a4a4a',
    'border.default': 'rgba(255, 255, 255, 0.08)', 'border.strong': 'rgba(255, 255, 255, 0.14)',
    'text.primary': '#f0f0f0', 'text.secondary': '#d0d0d0', 'text.muted': '#b5b5b5', 'text.disabled': '#888888',
    'text.link': '#c3a0f6',
    'accent.default': '#c3a0f6', 'accent.soft': '#403050', 'accent.hover': '#d1b4fa', 'accent.active': '#ddc7fc',
    'accent.foreground': '#261b33', 'navigation.active': '#c3a0f6',
    'control.selected.background': '#403050', 'control.selected.hover': '#473359', 'control.selected.active': '#4f3765',
    'scrollbar.thumb': 'rgba(255, 255, 255, 0.28)', 'scrollbar.hover': 'rgba(255, 255, 255, 0.38)', 'scrollbar.track': 'transparent',
    'interaction.hover': 'rgba(255, 255, 255, 0.06)', 'interaction.active': 'rgba(255, 255, 255, 0.12)',
    'selection.background': '#513967', 'selection.text': '#f3edf9', 'focus.border': '#c3a0f6',
    'status.danger.text': '#f2a5b2', 'status.danger.background': '#422431', 'status.danger.border': '#865062',
    'status.success.text': '#97d6ae', 'status.success.background': '#21372e', 'status.success.border': '#456e59',
    'status.warning.text': '#e9c385', 'status.warning.background': '#3d3126', 'status.warning.border': '#7f6744',
    'status.info.text': '#acc8f5', 'status.info.background': '#263249', 'status.info.border': '#506889',
    'folder.default.label': '#e8e8e8', 'folder.media.label': '#c3a0f6', 'folder.unknown.label': '#e9c385', 'folder.archive.label': '#c3a0f6',
    'editor.background': '#282c34', 'editor.text': '#abb2bf', 'editor.gutter': '#9da5b4', 'editor.cursor': '#d1b4fa',
    'editor.selection': '#513967', 'editor.activeLine': '#2c313a',
    'syntax.keyword': '#c8a6f7', 'syntax.string': '#a1d4b2', 'syntax.number': '#e7c18e', 'syntax.comment': '#ac9dbb',
    'syntax.function': '#acc8f5', 'syntax.type': '#e1acd4', 'syntax.operator': '#c6bce5', 'syntax.invalid': '#f2a5b2',
  },
} satisfies Record<'light' | 'dark', ColorTokens>;

export const BUILT_IN_COLOR_THEMES = Object.freeze([
  { id: 'omniflow.default', name: '森林', schemaVersion: 1, variants: { light: {}, dark: {} } },
  { id: 'omniflow.ocean', name: '海蓝', schemaVersion: 1, variants: {
    light: { 'surface.app': '#f3f6fb', 'surface.sidebar': '#e8eef7', 'surface.muted': '#eaf0f8', 'accent.default': '#245ba6', 'accent.soft': '#e0ebfa', 'accent.hover': '#194980', 'accent.active': '#123762', 'text.link': '#245ba6', 'focus.border': '#245ba6', 'selection.background': '#d8e8fc', 'folder.archive.label': '#405f9b', 'editor.background': '#f8faff' },
    dark: { 'surface.app': '#172231', 'surface.sidebar': '#1c2b3e', 'surface.panel': '#203149', 'surface.elevated': '#203149', 'surface.popover': '#203149', 'surface.input': '#203149', 'surface.muted': '#293c54', 'surface.raised': '#293c54', 'accent.default': '#80b4ff', 'accent.soft': '#294363', 'accent.hover': '#a2c9ff', 'accent.active': '#bedaff', 'text.link': '#80b4ff', 'focus.border': '#80b4ff', 'selection.background': '#314f76', 'folder.archive.label': '#9ebbf5', 'editor.background': '#172231', 'editor.selection': '#314f76', 'editor.activeLine': '#203149' },
  } },
  { id: 'omniflow.violet', name: '紫罗兰', schemaVersion: 1, variants: violet },
]);
export function findBuiltInColorTheme(id: string): unknown {
  const theme = BUILT_IN_COLOR_THEMES.find(theme => theme.id === id);
  return theme ? { id: theme.id, schemaVersion: theme.schemaVersion, variants: theme.variants } : undefined;
}
export const BUILT_IN_ICON_THEMES = Object.freeze([
  { id: 'omniflow.material', name: '彩色文件夹' },
  { id: 'omniflow.outline', name: '线条文件夹' },
]);
