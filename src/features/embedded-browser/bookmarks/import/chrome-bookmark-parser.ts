import type { BrowserBookmarkImportItem } from '@/features/embedded-browser/services/browser-bookmark.api';

type ChromeBookmarkEntry = {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromeBookmarkEntry[];
};

type ChromeBookmarkRoots = {
  bookmark_bar?: ChromeBookmarkEntry;
  other?: ChromeBookmarkEntry;
  synced?: ChromeBookmarkEntry;
  [key: string]: ChromeBookmarkEntry | undefined;
};

type ChromeBookmarkDocument = {
  roots?: ChromeBookmarkRoots;
};

const CHROME_IMPORT_ROOT_ORDER = ['bookmark_bar', 'other', 'synced'] as const;
const OTHER_BOOKMARKS_FOLDER_TITLE = '其他书签';

export function parseChromeBookmarkImport(raw: string): BrowserBookmarkImportItem[] {
  const parsed = safeParseChromeBookmarkDocument(raw);
  const roots = parsed.roots || {};

  const toolbarItems = parseChromeBookmarkChildren(roots.bookmark_bar?.children || []);
  const otherItems: BrowserBookmarkImportItem[] = [];

  for (const rootKey of CHROME_IMPORT_ROOT_ORDER) {
    if (rootKey === 'bookmark_bar') {
      continue;
    }
    otherItems.push(...parseChromeBookmarkChildren(roots[rootKey]?.children || []));
  }
  for (const [rootKey, rootValue] of Object.entries(roots)) {
    if (CHROME_IMPORT_ROOT_ORDER.includes(rootKey as typeof CHROME_IMPORT_ROOT_ORDER[number])) {
      continue;
    }
    otherItems.push(...parseChromeBookmarkChildren(rootValue?.children || []));
  }

  const items: BrowserBookmarkImportItem[] = [...toolbarItems];
  if (otherItems.length > 0) {
    items.push({
      kind: 'folder',
      title: OTHER_BOOKMARKS_FOLDER_TITLE,
      children: otherItems,
    });
  }
  if (items.length === 0) {
    throw new Error('未找到可导入的 Chrome 书签');
  }
  return items;
}

function safeParseChromeBookmarkDocument(raw: string): ChromeBookmarkDocument {
  try {
    return JSON.parse(raw) as ChromeBookmarkDocument;
  } catch {
    throw new Error('书签文件不是有效的 JSON');
  }
}

function parseChromeBookmarkChildren(entries: ChromeBookmarkEntry[]): BrowserBookmarkImportItem[] {
  const items: BrowserBookmarkImportItem[] = [];
  for (const entry of entries) {
    const item = parseChromeBookmarkEntry(entry);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

function parseChromeBookmarkEntry(entry: ChromeBookmarkEntry | null | undefined): BrowserBookmarkImportItem | null {
  const type = String(entry?.type || '').trim().toLowerCase();
  const title = String(entry?.name || '').trim();
  if (!title) {
    return null;
  }

  if (type === 'folder') {
    return {
      kind: 'folder',
      title,
      children: parseChromeBookmarkChildren(entry?.children || []),
    };
  }

  const rawUrl = String(entry?.url || '').trim();
  if (!rawUrl) {
    return null;
  }
  return {
    kind: 'url',
    title,
    url: rawUrl,
  };
}
