import type { BrowserBookmarkItem } from '@/features/embedded-browser/services/browser-bookmark.api';
import {
  getPersistableBookmarkIconUrl,
  getURLHost,
} from '@/features/embedded-browser/bookmarks/tree';

export type BookmarkIconDisplayEntry = {
  dataUrl: string;
  signature: string;
};

export function countBookmarkChildren(item: BrowserBookmarkItem) {
  let count = 0;
  const visit = (nodes: BrowserBookmarkItem[]) => {
    nodes.forEach((node) => {
      count += 1;
      if (node.children?.length) {
        visit(node.children);
      }
    });
  };
  visit(item.children || []);
  return count;
}

export function getBookmarkManagerMeta(item: BrowserBookmarkItem) {
  if (item.kind === 'folder') {
    const childCount = countBookmarkChildren(item);
    return childCount > 0 ? `${childCount} 项` : '空文件夹';
  }
  return getURLHost(item.url || '') || item.url || '未设置网址';
}

export function getBookmarkIconDisplaySignature(input: { iconUrl?: string | null; url?: string | null }) {
  return `${String(input.url || '').trim()}::${getPersistableBookmarkIconUrl(input.iconUrl)}`;
}
