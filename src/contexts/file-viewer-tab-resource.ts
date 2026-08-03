import type {
  FileViewerTab,
  FileViewerTabResourceUpdate,
} from './file-viewer.context';

export interface FileViewerTabResourceUpdateResult {
  tabs: FileViewerTab[];
  updatedTab: FileViewerTab;
}

export function updateExistingFileViewerTabResource(
  tabs: FileViewerTab[],
  tabId: string,
  update: FileViewerTabResourceUpdate,
): FileViewerTabResourceUpdateResult | null {
  const normalizedUrl = String(update.fileUrl || '').trim();
  if (!tabId || !normalizedUrl) return null;
  const targetIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (targetIndex < 0) return null;
  const targetTab = tabs[targetIndex];
  if (targetTab.nodeId !== update.expectedNodeId) return null;
  const updatedTab: FileViewerTab = {
    ...targetTab,
    fileUrl: normalizedUrl,
    contentRevision: String(update.contentRevision || '').trim() || null,
  };
  const nextTabs = [...tabs];
  nextTabs[targetIndex] = updatedTab;
  return { tabs: nextTabs, updatedTab };
}
