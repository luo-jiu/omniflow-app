import {
  BROWSER_SETTINGS_TAB_ID,
} from './layout-constants';
import type { BrowserTab } from './workspace-state';

function createBrowserTabId() {
  return `browser-tab:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function createBrowserTab(): BrowserTab {
  return {
    canGoBack: false,
    canGoForward: false,
    id: createBrowserTabId(),
    kind: 'page',
    title: '新标签页',
    url: '',
  };
}

export function createBrowserSettingsTab(): BrowserTab {
  return {
    canGoBack: false,
    canGoForward: false,
    id: BROWSER_SETTINGS_TAB_ID,
    kind: 'settings',
    title: '设置',
    url: '',
  };
}

export function isBrowserSettingsTab(tab: BrowserTab | null | undefined) {
  return tab?.kind === 'settings';
}

export function updateBrowserTabList(
  tabs: BrowserTab[],
  tabId: string,
  updater: (tab: BrowserTab) => BrowserTab,
) {
  return tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
}

export function reorderBrowserTabs(
  tabs: BrowserTab[],
  draggedTabId: string,
  targetTabId: string,
  position: 'before' | 'after',
) {
  if (draggedTabId === targetTabId) {
    return tabs;
  }

  const draggedIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  const adjustedTargetIndex = nextTabs.findIndex((tab) => tab.id === targetTabId);
  if (adjustedTargetIndex < 0) {
    return tabs;
  }
  const insertIndex = position === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  nextTabs.splice(insertIndex, 0, draggedTab);
  return nextTabs;
}

export function createEmptyBrowserTab() {
  const nextTab = createBrowserTab();
  return {
    id: nextTab.id,
    tab: nextTab,
  };
}
