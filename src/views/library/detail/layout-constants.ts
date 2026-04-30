export const DEFAULT_SIDE_PANEL_WIDTH = 360;
export const MIN_SIDE_PANEL_WIDTH = 360;
export const DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH = 360;
export const MIN_BROWSER_RESOURCE_PANEL_WIDTH = DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
export const MAX_BROWSER_RESOURCE_PANEL_WIDTH = DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH * 2;
export const SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT = 37;
export const CONTENT_TOOLBAR_HEIGHT = 56;
export const TOOLBAR_ACTION_BUTTON_SIZE = 36;
export const TOOLBAR_ACTION_ICON_SIZE = 18;
export const BROWSER_TAB_ICON_SIZE = 20;
export const BROWSER_TAB_FONT_SIZE = 16;
export const BOOKMARK_ICON_SIZE = 20;
export const BOOKMARK_FONT_SIZE = 17;
export const BROWSER_INPUT_FONT_SIZE = 18;
export const BROWSER_TAB_HEIGHT = 38;
export const BOOKMARK_TOOLBAR_HEIGHT = 42;
export const BOOKMARK_ITEM_HEIGHT = 38;
export const BROWSER_INPUT_HEIGHT = 38;
export const BOOKMARK_TOOLBAR_HORIZONTAL_PADDING = 20;
export const SIDE_PANEL_TOGGLE_LEFT = 110;
export const SIDE_PANEL_TOGGLE_TOP = (CONTENT_TOOLBAR_HEIGHT - TOOLBAR_ACTION_BUTTON_SIZE) / 2 - 1;
export const SIDE_PANEL_TOGGLE_SIZE = TOOLBAR_ACTION_BUTTON_SIZE;
export const SIDE_PANEL_TOGGLE_ICON_SIZE = 24;
export const CONTENT_TOOLBAR_COLLAPSED_SAFE_SPACE = SIDE_PANEL_TOGGLE_LEFT + SIDE_PANEL_TOGGLE_SIZE + 8;
export const SIDE_PANEL_COLLAPSE_ANIMATION_MS = 260;
export const BROWSER_SETTINGS_TAB_ID = 'browser-internal:settings';

const SIDE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:side-panel-width:';
const BROWSER_RESOURCE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:browser-resource-panel-width:';

function getSidePanelWidthStorageKey(libraryId: number) {
  return `${SIDE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
}

function getBrowserResourcePanelWidthStorageKey(libraryId: number) {
  return `${BROWSER_RESOURCE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
}

export function loadSidePanelWidth(libraryId: number): number {
  const raw = localStorage.getItem(getSidePanelWidthStorageKey(libraryId));
  if (!raw) return DEFAULT_SIDE_PANEL_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDE_PANEL_WIDTH;
  return Math.max(MIN_SIDE_PANEL_WIDTH, Math.floor(parsed));
}

export function saveSidePanelWidth(libraryId: number, width: number) {
  localStorage.setItem(getSidePanelWidthStorageKey(libraryId), String(Math.floor(width)));
}

export function loadBrowserResourcePanelWidth(libraryId: number): number {
  const raw = localStorage.getItem(getBrowserResourcePanelWidthStorageKey(libraryId));
  if (!raw) return DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
  return Math.max(
    MIN_BROWSER_RESOURCE_PANEL_WIDTH,
    Math.min(MAX_BROWSER_RESOURCE_PANEL_WIDTH, Math.floor(parsed)),
  );
}

export function saveBrowserResourcePanelWidth(libraryId: number, width: number) {
  localStorage.setItem(
    getBrowserResourcePanelWidthStorageKey(libraryId),
    String(
      Math.max(
        MIN_BROWSER_RESOURCE_PANEL_WIDTH,
        Math.min(MAX_BROWSER_RESOURCE_PANEL_WIDTH, Math.floor(width)),
      ),
    ),
  );
}
