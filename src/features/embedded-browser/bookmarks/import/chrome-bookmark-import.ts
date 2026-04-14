import { importBrowserBookmarks } from '@/features/embedded-browser/services/browser-bookmark.api';

import { parseChromeBookmarkImport } from './chrome-bookmark-parser';

const MAC_CHROME_BOOKMARK_PATH = '~/Library/Application Support/Google/Chrome/Default/Bookmarks';

export async function importChromeBookmarksFromText(raw: string, source: string) {
  const items = parseChromeBookmarkImport(raw);
  return importBrowserBookmarks({
    source,
    items,
  });
}

export async function pickChromeBookmarkImportFile() {
  if (!window.electronAPI?.openTextFile) {
    throw new Error('当前环境不支持选择本地书签文件');
  }
  const result = await window.electronAPI.openTextFile();
  if (result.canceled) {
    return null;
  }
  return result;
}

export async function loadLocalChromeBookmarkFile() {
  if (!window.electronAPI?.readLocalChromeBookmarks) {
    throw new Error('当前环境不支持读取本地 Chrome 书签');
  }
  return window.electronAPI.readLocalChromeBookmarks();
}

export function getLocalChromeBookmarkImportHint() {
  return MAC_CHROME_BOOKMARK_PATH;
}
