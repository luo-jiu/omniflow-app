export const BUILT_IN_COLOR_THEMES = Object.freeze([
  { id: 'omniflow.default', name: '森林', schemaVersion: 1, variants: { light: {}, dark: {} } },
  { id: 'omniflow.ocean', name: '海蓝', schemaVersion: 1, variants: {
    light: { 'surface.app': '#f3f6fb', 'surface.sidebar': '#e8eef7', 'surface.muted': '#eaf0f8', 'accent.default': '#245ba6', 'accent.soft': '#e0ebfa', 'accent.hover': '#194980', 'accent.active': '#123762', 'text.link': '#245ba6', 'focus.border': '#245ba6', 'selection.background': '#d8e8fc', 'folder.archive.label': '#405f9b', 'editor.background': '#f8faff' },
    dark: { 'surface.app': '#172231', 'surface.sidebar': '#1c2b3e', 'surface.panel': '#203149', 'surface.elevated': '#203149', 'surface.popover': '#203149', 'surface.input': '#203149', 'surface.muted': '#293c54', 'surface.raised': '#293c54', 'accent.default': '#80b4ff', 'accent.soft': '#294363', 'accent.hover': '#a2c9ff', 'accent.active': '#bedaff', 'text.link': '#80b4ff', 'focus.border': '#80b4ff', 'selection.background': '#314f76', 'folder.archive.label': '#9ebbf5', 'editor.background': '#172231', 'editor.selection': '#314f76', 'editor.activeLine': '#203149' },
  } },
]);
export function findBuiltInColorTheme(id: string): unknown {
  const theme = BUILT_IN_COLOR_THEMES.find(theme => theme.id === id);
  return theme ? { id: theme.id, schemaVersion: theme.schemaVersion, variants: theme.variants } : undefined;
}
export const BUILT_IN_ICON_THEMES = Object.freeze([
  { id: 'omniflow.material', name: '彩色文件夹' },
  { id: 'omniflow.outline', name: '线条文件夹' },
]);
