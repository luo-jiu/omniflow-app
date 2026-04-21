import type { SearchWorkspaceMode } from './SearchWorkspace';

export type BrowserTabKind = 'page' | 'settings';

export type BrowserTab = {
  canGoBack?: boolean;
  canGoForward?: boolean;
  id: string;
  iconSourceUrl?: string;
  iconUrl?: string;
  kind?: BrowserTabKind;
  title: string;
  url: string;
};

export type WorkspaceDisplayMode = 'search-home' | 'file-viewer' | 'browser' | 'tools';

export interface LibraryDetailWorkspaceState {
  activeBrowserTabId: string | null;
  browserInput: string;
  browserModeOpen: boolean;
  browserTabs: BrowserTab[];
  searchDraft: string;
  searchMode: SearchWorkspaceMode;
  workspaceDisplayMode: WorkspaceDisplayMode;
}

const defaultLibraryDetailWorkspaceState: LibraryDetailWorkspaceState = {
  activeBrowserTabId: null,
  browserInput: '',
  browserModeOpen: false,
  browserTabs: [],
  searchDraft: '',
  searchMode: 'files',
  workspaceDisplayMode: 'search-home',
};

export function createDefaultLibraryDetailWorkspaceState(): LibraryDetailWorkspaceState {
  return {
    ...defaultLibraryDetailWorkspaceState,
    browserTabs: [],
  };
}

const libraryDetailWorkspaceStateCache = new Map<string, LibraryDetailWorkspaceState>();

function normalizeBrowserTab(raw: BrowserTab | null | undefined): BrowserTab | null {
  if (!raw) {
    return null;
  }
  const id = String(raw.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    canGoBack: Boolean(raw.canGoBack),
    canGoForward: Boolean(raw.canGoForward),
    id,
    iconSourceUrl: String(raw.iconSourceUrl || '').trim() || undefined,
    iconUrl: String(raw.iconUrl || '').trim() || undefined,
    kind: raw.kind === 'settings' ? 'settings' : 'page',
    title: String(raw.title || '').trim() || '新标签页',
    url: String(raw.url || '').trim(),
  };
}

export function normalizeLibraryDetailWorkspaceState(
  raw: LibraryDetailWorkspaceState | null | undefined,
): LibraryDetailWorkspaceState {
  if (!raw) {
    return createDefaultLibraryDetailWorkspaceState();
  }

  const browserTabs = Array.isArray(raw.browserTabs)
    ? raw.browserTabs
        .map((tab) => normalizeBrowserTab(tab))
        .filter((tab): tab is BrowserTab => Boolean(tab))
    : [];

  const rawActiveBrowserTabId = String(raw.activeBrowserTabId || '').trim();
  const activeBrowserTab = browserTabs.find((tab) => tab.id === rawActiveBrowserTabId)
    ?? browserTabs[browserTabs.length - 1]
    ?? null;
  const activeBrowserTabId = activeBrowserTab?.id ?? null;

  const browserModeOpen = Boolean(raw.browserModeOpen && activeBrowserTabId && browserTabs.length > 0);
  const searchMode: SearchWorkspaceMode = raw.searchMode === 'web' ? 'web' : 'files';

  let workspaceDisplayMode: WorkspaceDisplayMode = raw.workspaceDisplayMode === 'file-viewer'
    ? 'file-viewer'
    : raw.workspaceDisplayMode === 'browser'
      ? 'browser'
      : raw.workspaceDisplayMode === 'tools'
        ? 'tools'
      : 'search-home';
  if (workspaceDisplayMode === 'browser' && !browserModeOpen) {
    workspaceDisplayMode = 'search-home';
  }

  const browserInput = String(raw.browserInput || '').trim() || activeBrowserTab?.url || '';

  return {
    activeBrowserTabId,
    browserInput,
    browserModeOpen,
    browserTabs,
    searchDraft: String(raw.searchDraft || ''),
    searchMode,
    workspaceDisplayMode,
  };
}

export function loadLibraryDetailWorkspaceState(cacheKey?: string): LibraryDetailWorkspaceState {
  if (!cacheKey) {
    return createDefaultLibraryDetailWorkspaceState();
  }
  return normalizeLibraryDetailWorkspaceState(libraryDetailWorkspaceStateCache.get(cacheKey));
}

export function saveLibraryDetailWorkspaceState(
  cacheKey: string | undefined,
  state: LibraryDetailWorkspaceState,
) {
  if (!cacheKey) {
    return;
  }
  libraryDetailWorkspaceStateCache.set(cacheKey, normalizeLibraryDetailWorkspaceState(state));
}

export function clearLibraryDetailWorkspaceState(cacheKey?: string) {
  if (!cacheKey) {
    return;
  }
  libraryDetailWorkspaceStateCache.delete(cacheKey);
}
