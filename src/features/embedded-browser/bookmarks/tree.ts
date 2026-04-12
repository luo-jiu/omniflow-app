import type { BrowserBookmarkItem } from '@/features/embedded-browser/services/browser-bookmark.api';

export const ROOT_BOOKMARK_PARENT_VALUE = '__bookmark-root__';

export type BrowserBookmarkParentOption = {
  label: string;
  value: string;
};

export function isURLBookmark(item: BrowserBookmarkItem | null | undefined): item is BrowserBookmarkItem {
  return Boolean(item && item.kind === 'url' && item.url);
}

export function getURLHost(rawUrl: string) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return '';
  }
}

export function getDefaultBookmarkTitle(rawUrl: string, fallback?: string | null) {
  const normalizedFallback = String(fallback || '').trim();
  if (normalizedFallback && normalizedFallback !== '新标签页') {
    return normalizedFallback.slice(0, 255);
  }
  return getURLHost(rawUrl) || rawUrl;
}

export function estimateBookmarkWidth(item: BrowserBookmarkItem) {
  const titleLength = String(item.title || '').length;
  return Math.min(Math.max(74 + titleLength * 8, 104), 190);
}

export function resolveVisibleBookmarkCount(items: BrowserBookmarkItem[], containerWidth: number) {
  if (items.length === 0 || containerWidth <= 0) {
    return items.length;
  }
  const moreButtonWidth = 42;
  let usedWidth = 0;
  for (let index = 0; index < items.length; index += 1) {
    usedWidth += estimateBookmarkWidth(items[index]) + 6;
    const remaining = items.length - index - 1;
    const reserved = remaining > 0 ? moreButtonWidth : 0;
    if (usedWidth + reserved > containerWidth) {
      return Math.max(index, 0);
    }
  }
  return items.length;
}

export function collectURLBookmarkItems(items: BrowserBookmarkItem[]) {
  const collected: BrowserBookmarkItem[] = [];
  const visit = (nodes: BrowserBookmarkItem[]) => {
    nodes.forEach((item) => {
      if (isURLBookmark(item)) {
        collected.push(item);
      }
      if (item.children?.length) {
        visit(item.children);
      }
    });
  };
  visit(items);
  return collected;
}

export function replaceBookmarkIconInTree(
  items: BrowserBookmarkItem[],
  bookmarkId: number,
  iconUrl: string,
): BrowserBookmarkItem[] {
  let changed = false;
  const nextItems = items.map((item) => {
    let nextItem = item;
    if (item.id === bookmarkId) {
      changed = true;
      nextItem = { ...nextItem, iconUrl };
    }
    if (item.children?.length) {
      const nextChildren = replaceBookmarkIconInTree(item.children, bookmarkId, iconUrl);
      if (nextChildren !== item.children) {
        changed = true;
        nextItem = { ...nextItem, children: nextChildren };
      }
    }
    return nextItem;
  });
  return changed ? nextItems : items;
}

export function getPersistableBookmarkIconUrl(rawIconUrl?: string | null) {
  const iconUrl = String(rawIconUrl || '').trim();
  return iconUrl && !iconUrl.startsWith('data:') ? iconUrl : '';
}

export function collectBookmarkFolderIds(items: BrowserBookmarkItem[]) {
  const folderIds: number[] = [];
  const visit = (nodes: BrowserBookmarkItem[]) => {
    nodes.forEach((item) => {
      if (item.kind === 'folder') {
        folderIds.push(item.id);
        if (item.children?.length) {
          visit(item.children);
        }
      }
    });
  };
  visit(items);
  return folderIds;
}

function collectBookmarkDescendantIds(item: BrowserBookmarkItem) {
  const ids = new Set<number>();
  const visit = (nodes: BrowserBookmarkItem[]) => {
    nodes.forEach((child) => {
      ids.add(child.id);
      if (child.children?.length) {
        visit(child.children);
      }
    });
  };
  visit(item.children || []);
  return ids;
}

export function buildBookmarkParentOptions(
  items: BrowserBookmarkItem[],
  editingItem: BrowserBookmarkItem | null,
): BrowserBookmarkParentOption[] {
  const options: BrowserBookmarkParentOption[] = [
    { label: '书签栏', value: ROOT_BOOKMARK_PARENT_VALUE },
  ];
  const excludedIds = new Set<number>();
  if (editingItem) {
    excludedIds.add(editingItem.id);
    if (editingItem.kind === 'folder') {
      collectBookmarkDescendantIds(editingItem).forEach((id) => excludedIds.add(id));
    }
  }

  const visit = (nodes: BrowserBookmarkItem[], depth: number) => {
    nodes.forEach((item) => {
      if (item.kind !== 'folder') {
        return;
      }
      if (!excludedIds.has(item.id)) {
        options.push({
          label: `${'-> '.repeat(depth)}${item.title || '未命名文件夹'}`,
          value: String(item.id),
        });
      }
      if (item.children?.length) {
        visit(item.children, depth + 1);
      }
    });
  };

  visit(items, 0);
  return options;
}
