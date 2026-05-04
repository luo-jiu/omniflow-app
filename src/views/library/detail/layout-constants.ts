export const DEFAULT_SIDE_PANEL_WIDTH = 250;
export const MIN_SIDE_PANEL_WIDTH = 240;
export const DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH = 260;
export const MIN_BROWSER_RESOURCE_PANEL_WIDTH = DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
export const MAX_BROWSER_RESOURCE_PANEL_WIDTH = DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH * 2;
export const SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT = 30;
export const CONTENT_TOOLBAR_HEIGHT = 38;
export const TOOLBAR_ACTION_BUTTON_SIZE = 28;
export const TOOLBAR_ACTION_ICON_SIZE = 15;
export const BROWSER_TAB_ICON_SIZE = 14;
export const BROWSER_TAB_FONT_SIZE = 11;
export const BOOKMARK_ICON_SIZE = 14;
export const BOOKMARK_FONT_SIZE = 11;
export const BROWSER_INPUT_FONT_SIZE = 12;
export const BROWSER_TAB_HEIGHT = 28;
export const BOOKMARK_TOOLBAR_HEIGHT = 30;
export const BOOKMARK_ITEM_HEIGHT = 26;
export const BROWSER_INPUT_HEIGHT = 28;
export const BOOKMARK_TOOLBAR_HORIZONTAL_PADDING = 13;
export const SIDE_PANEL_TOGGLE_LEFT = 85;
export const SIDE_PANEL_TOGGLE_VISUAL_LEFT = SIDE_PANEL_TOGGLE_LEFT - 10;
export const SIDE_PANEL_TOGGLE_TOP = (CONTENT_TOOLBAR_HEIGHT - TOOLBAR_ACTION_BUTTON_SIZE) / 2;
export const SIDE_PANEL_TOGGLE_SIZE = TOOLBAR_ACTION_BUTTON_SIZE;
export const SIDE_PANEL_TOGGLE_ICON_SIZE = 18;
export const CONTENT_TOOLBAR_COLLAPSED_SAFE_SPACE = SIDE_PANEL_TOGGLE_VISUAL_LEFT + SIDE_PANEL_TOGGLE_SIZE + 4;
export const SIDE_PANEL_COLLAPSE_ANIMATION_MS = 260;
export const BROWSER_SETTINGS_TAB_ID = 'browser-internal:settings';

const SIDE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:side-panel-width:';
const SIDE_PANEL_WIDTH_DENSITY_MIGRATION_PREFIX = 'library-detail:side-panel-width-density-migrated:';
const BROWSER_RESOURCE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:browser-resource-panel-width:';

function getSidePanelWidthStorageKey(libraryId: number) {
  return `${SIDE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
}

function getSidePanelWidthDensityMigrationKey(libraryId: number) {
  return `${SIDE_PANEL_WIDTH_DENSITY_MIGRATION_PREFIX}${libraryId}`;
}

function getBrowserResourcePanelWidthStorageKey(libraryId: number) {
  return `${BROWSER_RESOURCE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
}

export function loadSidePanelWidth(libraryId: number): number {
  const raw = localStorage.getItem(getSidePanelWidthStorageKey(libraryId));
  if (!raw) return DEFAULT_SIDE_PANEL_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDE_PANEL_WIDTH;
  const migrationKey = getSidePanelWidthDensityMigrationKey(libraryId);
  if (parsed >= 340 && parsed <= 380 && localStorage.getItem(migrationKey) !== '1') {
    localStorage.setItem(migrationKey, '1');
    localStorage.setItem(getSidePanelWidthStorageKey(libraryId), String(DEFAULT_SIDE_PANEL_WIDTH));
    return DEFAULT_SIDE_PANEL_WIDTH;
  }
  return Math.max(MIN_SIDE_PANEL_WIDTH, Math.floor(parsed));
}

export function saveSidePanelWidth(libraryId: number, width: number) {
  localStorage.setItem(getSidePanelWidthDensityMigrationKey(libraryId), '1');
  localStorage.setItem(
    getSidePanelWidthStorageKey(libraryId),
    String(Math.max(MIN_SIDE_PANEL_WIDTH, Math.floor(width))),
  );
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
