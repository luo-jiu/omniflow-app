import React from 'react';
import {
  IconGlobeStroke,
  IconSetting,
} from '@douyinfe/semi-icons';
import type { BrowserBookmarkItem } from '@/features/embedded-browser/services/browser-bookmark.api';
import {
  getCachedFaviconDataUrl,
} from '@/features/embedded-browser/services/favicon-cache';
import {
  getPersistableBookmarkIconUrl,
} from '@/features/embedded-browser/bookmarks/tree';
import type { BrowserTab } from './workspace-state';
import { isBrowserSettingsTab } from './browser-tabs';
import type { BookmarkIconDisplayEntry } from './bookmark-visual-helpers';

function canRenderImageUnderAppCsp(rawSrc: string) {
  if (!rawSrc) {
    return false;
  }
  if (rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) {
    return true;
  }
  if (rawSrc.startsWith('//')) {
    return false;
  }
  if (rawSrc.startsWith('/') || rawSrc.startsWith('./') || rawSrc.startsWith('../')) {
    return true;
  }
  try {
    const url = new URL(rawSrc);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

const FaviconImage: React.FC<{
  alt?: string;
  className: string;
  src?: string | null;
  style?: React.CSSProperties;
}> = ({ alt = '', className, src, style }) => {
  const normalizedSrc = String(src || '').trim();
  const renderableSrc = canRenderImageUnderAppCsp(normalizedSrc) ? normalizedSrc : '';
  const [loadState, setLoadState] = React.useState<'idle' | 'loaded' | 'error'>(() => (
    renderableSrc ? 'idle' : 'error'
  ));

  React.useEffect(() => {
    setLoadState(renderableSrc ? 'idle' : 'error');
  }, [renderableSrc]);

  const showFallback = !renderableSrc || loadState !== 'loaded';

  if (showFallback && !renderableSrc) {
    return (
      <span
        aria-hidden="true"
        className={`${className} favicon-fallback`}
        style={style}
      >
        <IconGlobeStroke size="small" />
      </span>
    );
  }

  return (
    <>
      {showFallback ? (
        <span
          aria-hidden="true"
          className={`${className} favicon-fallback`}
          style={style}
        >
          <IconGlobeStroke size="small" />
        </span>
      ) : null}
      {renderableSrc ? (
        <img
          alt={alt}
          className={className}
          draggable={false}
          src={renderableSrc}
          style={{
            ...style,
            display: loadState === 'loaded' ? undefined : 'none',
          }}
          onLoad={() => setLoadState('loaded')}
          onError={() => setLoadState('error')}
        />
      ) : null}
    </>
  );
};

export const BookmarkVisual: React.FC<{
  cacheOwnerKey?: string;
  displayIcon?: BookmarkIconDisplayEntry;
  item: BrowserBookmarkItem;
}> = ({ cacheOwnerKey, displayIcon, item }) => {
  if (item.kind === 'folder') {
    return <span className="bookmark-folder-glyph" aria-hidden="true" />;
  }
  const displayIconUrl = displayIcon?.dataUrl || '';
  const iconUrl = displayIconUrl
    || getCachedFaviconDataUrl({
      ownerKey: cacheOwnerKey,
      iconUrl: item.iconUrl,
      pageUrl: item.url,
    })
    || getPersistableBookmarkIconUrl(item.iconUrl);
  return (
    <FaviconImage
      className="bookmark-favicon"
      src={iconUrl}
      style={{ height: 16, width: 16 }}
    />
  );
};

export const BrowserTabVisual: React.FC<{ cacheOwnerKey?: string; tab: BrowserTab }> = ({ cacheOwnerKey, tab }) => {
  if (isBrowserSettingsTab(tab)) {
    return (
      <span className="browser-tab-favicon favicon-fallback" aria-hidden="true">
        <IconSetting size="small" />
      </span>
    );
  }
  const iconUrl = tab.iconUrl || getCachedFaviconDataUrl({
    ownerKey: cacheOwnerKey,
    iconUrl: tab.iconSourceUrl,
    pageUrl: tab.url,
  });
  return (
    <FaviconImage
      className="browser-tab-favicon"
      src={iconUrl}
    />
  );
};
