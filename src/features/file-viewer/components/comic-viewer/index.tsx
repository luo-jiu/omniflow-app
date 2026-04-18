import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Popover, Slider, Spin } from '@douyinfe/semi-ui';
import {
  batchGetFileLinks,
  fetchNodeDetailById,
  getChildrenByNodeId,
  updateNodeConfig,
} from '@/features/file-explorer/services/file.api';
import { ComicViewerWrapper } from './style';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface ComicViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
  reloadToken?: number;
}

interface ComicChildNode {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  type: 'dir' | 'file' | number | string;
}

interface ComicPageItem {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  url: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

type ReaderLayoutMode = 'scroll' | 'flip';
type ScrollColumnMode = 1 | 2;

interface ComicReaderSnapshot {
  hasLoadedList: boolean;
  pages: ComicPageItem[];
  visibleCount: number;
  scrollTop: number;
  scrollRatio: number;
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  updatedAt: string;
}

const INITIAL_VISIBLE_COUNT = 12;
const LOAD_MORE_STEP = 10;
const PREFETCH_AHEAD = 48;
const MAX_RESOLVE_PER_TICK = 64;
const COMIC_LINK_EXPIRY_MINUTES = 240;
const MIN_PAGE_WIDTH = 360;
const MAX_PAGE_WIDTH = 980;
const DOUBLE_COLUMN_INNER_GAP = 0;
const SINGLE_SCROLL_ZOOM_MIN = 0.45;
const SINGLE_SCROLL_ZOOM_MAX = 3.2;
const DOUBLE_SCROLL_ZOOM_MIN = 0.55;
const DOUBLE_SCROLL_ZOOM_MAX = 1;
const FLIP_ZOOM_MIN = 0.4;
const FLIP_ZOOM_MAX = 4.2;
const CTRL_WHEEL_ZOOM_STEP = 0.08;
const FLIP_DECODE_WINDOW_BEHIND = 2;
const FLIP_DECODE_WINDOW_AHEAD = 8;
const DEFAULT_SCROLL_PAGE_GAP_PX = 0;
const MAX_SCROLL_PAGE_GAP_PX = 100;
const COMIC_READER_CACHE_MAX_ENTRIES = 24;
const REMOTE_PROGRESS_SYNC_INTERVAL_MS = 1000;
const BACK_TO_TOP_DIRECT_PAGE_THRESHOLD = 300;
const BACK_TO_TOP_ANIMATION_MIN_MS = 180;
const BACK_TO_TOP_ANIMATION_MAX_MS = 420;
const VIEW_META_VIEWER_STATE_KEY = '__omniflowViewerStateV1';
const VIEW_META_VIEWER_STATE_LEGACY_KEY = '__omniflow_viewer_state_v1';
const VIEW_META_COMIC_READER_KEY = 'comicReader';
const VIEW_META_COMIC_READER_LEGACY_KEY = 'comic_reader';
const EMPTY_COMIC_READER_SNAPSHOT: ComicReaderSnapshot = {
  hasLoadedList: false,
  pages: [],
  visibleCount: 0,
  scrollTop: 0,
  scrollRatio: 0,
  anchorPageId: null,
  anchorOffsetRatio: 0,
  updatedAt: '',
};

const comicReaderSnapshotCache = new Map<string, ComicReaderSnapshot>();

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif']);

function normalizeExt(ext?: string): string {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

function isHiddenNodeName(name?: string, ext?: string): boolean {
  const trimmedName = String(name || '').trim();
  if (trimmedName.startsWith('.')) {
    return true;
  }
  const normalizedExt = normalizeExt(ext);
  // Back-end may split `.thumb` into name="" and ext="thumb".
  return trimmedName.length === 0 && normalizedExt.length > 0;
}

function isImageNode(item: ComicChildNode): boolean {
  if (isHiddenNodeName(item.name, item.ext)) {
    return false;
  }
  if (!(String(item.type) === 'file' || Number(item.type) === 1)) {
    return false;
  }
  if (item.mimeType && item.mimeType.startsWith('image/')) {
    return true;
  }
  return IMAGE_EXTENSIONS.has(normalizeExt(item.ext));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeOutCubic(t: number): number {
  const p = clamp(t, 0, 1);
  return 1 - (1 - p) ** 3;
}

function getScrollZoomBounds(columnMode: ScrollColumnMode) {
  return columnMode === 2
    ? { min: DOUBLE_SCROLL_ZOOM_MIN, max: DOUBLE_SCROLL_ZOOM_MAX }
    : { min: SINGLE_SCROLL_ZOOM_MIN, max: SINGLE_SCROLL_ZOOM_MAX };
}

function parseComicLibraryId(fileUrl: string): number | null {
  const matches = /^comic:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeComicTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return '漫画预览';
  if (raw.toUpperCase().startsWith('COMIC ·')) {
    const parts = raw.split('·');
    if (parts.length >= 2) {
      const right = parts.slice(1).join('·').trim();
      if (right) return right;
    }
  }
  return raw;
}

function resolveReaderCacheKey(
  fileUrl: string,
  folderNodeId: number | null,
  reloadToken: number,
): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) {
    return null;
  }
  return `${String(fileUrl || '').trim()}::${folderNodeId}::r${Math.max(Math.floor(reloadToken), 0)}`;
}

function setReaderSnapshotCache(cacheKey: string, snapshot: ComicReaderSnapshot) {
  if (comicReaderSnapshotCache.has(cacheKey)) {
    comicReaderSnapshotCache.delete(cacheKey);
  }
  comicReaderSnapshotCache.set(cacheKey, snapshot);
  if (comicReaderSnapshotCache.size > COMIC_READER_CACHE_MAX_ENTRIES) {
    const oldestKey = comicReaderSnapshotCache.keys().next().value;
    if (oldestKey) {
      comicReaderSnapshotCache.delete(oldestKey);
    }
  }
}

function normalizeCachedPages(pages: ComicPageItem[]): ComicPageItem[] {
  // In-flight requests are session-bound; when remounting, treat stale "loading" as "idle" for retry.
  return pages.map((page) => (
    page.status === 'loading'
      ? { ...page, status: 'idle' as const }
      : page
  ));
}

interface AnchorSnapshot {
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  currentPageNumber: number;
}

interface CenterPageSnapshot {
  pageId: number | null;
  pageIndex: number;
}

interface ComicRemoteReadingProgress {
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  scrollTop: number;
  scrollRatio: number;
  currentPageNumber: number;
  hasCurrentPageNumber?: boolean;
  updatedAt: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseViewMetaObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseRatio(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1);
}

function parseComicRemoteReadingProgress(viewMetaRaw: string | null | undefined): ComicRemoteReadingProgress | null {
  const meta = parseViewMetaObject(viewMetaRaw);
  const viewerState = meta[VIEW_META_VIEWER_STATE_KEY] ?? meta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  if (!isPlainObject(viewerState)) {
    return null;
  }
  const comicReaderState = viewerState[VIEW_META_COMIC_READER_KEY] ?? viewerState[VIEW_META_COMIC_READER_LEGACY_KEY];
  if (!isPlainObject(comicReaderState)) {
    return null;
  }
  const currentPageNumber = parsePositiveNumber(comicReaderState.currentPageNumber);
  const anchorPageId = parsePositiveNumber(comicReaderState.anchorPageId);
  const scrollTop = Number(comicReaderState.scrollTop ?? 0);
  const currentScrollTop = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const currentScrollRatio = parseRatio(comicReaderState.scrollRatio);
  if (!currentPageNumber && !anchorPageId && currentScrollTop <= 0 && currentScrollRatio <= 0) {
    return null;
  }
  return {
    anchorPageId,
    anchorOffsetRatio: parseRatio(comicReaderState.anchorOffsetRatio),
    scrollTop: currentScrollTop,
    scrollRatio: currentScrollRatio,
    currentPageNumber: currentPageNumber ?? 1,
    hasCurrentPageNumber: Boolean(currentPageNumber),
    updatedAt: String(comicReaderState.updatedAt || ''),
  };
}

function buildNextViewMetaWithComicProgress(
  baseMeta: Record<string, unknown>,
  progress: ComicRemoteReadingProgress,
): Record<string, unknown> {
  const nextMeta: Record<string, unknown> = { ...baseMeta };
  const viewerStateCandidate = nextMeta[VIEW_META_VIEWER_STATE_KEY] ?? nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  const currentViewerState = isPlainObject(viewerStateCandidate)
    ? { ...(viewerStateCandidate as Record<string, unknown>) }
    : {};
  delete currentViewerState[VIEW_META_COMIC_READER_LEGACY_KEY];
  delete nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  nextMeta[VIEW_META_VIEWER_STATE_KEY] = {
    ...currentViewerState,
    [VIEW_META_COMIC_READER_KEY]: {
      anchorPageId: progress.anchorPageId,
      anchorOffsetRatio: progress.anchorOffsetRatio,
      scrollTop: progress.scrollTop,
      scrollRatio: progress.scrollRatio,
      currentPageNumber: progress.currentPageNumber,
      updatedAt: progress.updatedAt,
    },
  };
  return nextMeta;
}

function resolveRemoteRestoreTarget(
  pages: ComicPageItem[],
  remoteProgress: ComicRemoteReadingProgress,
): {
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  scrollTop: number;
  scrollRatio: number;
  pageNumber: number;
  updatedAt: string;
} | null {
  if (pages.length === 0) {
    return null;
  }

  const targetByAnchor = remoteProgress.anchorPageId
    ? pages.findIndex(page => page.id === remoteProgress.anchorPageId)
    : -1;
  const targetByPage = remoteProgress.hasCurrentPageNumber
    ? clamp(Math.floor(remoteProgress.currentPageNumber || 1), 1, pages.length) - 1
    : -1;
  const targetIndex = targetByAnchor >= 0 ? targetByAnchor : targetByPage;
  const targetPage = targetIndex >= 0 ? pages[targetIndex] : null;
  if (!targetPage) {
    return {
      anchorPageId: null,
      anchorOffsetRatio: 0,
      scrollTop: Math.max(remoteProgress.scrollTop, 0),
      scrollRatio: clamp(remoteProgress.scrollRatio, 0, 1),
      pageNumber: 1,
      updatedAt: remoteProgress.updatedAt,
    };
  }
  return {
    anchorPageId: targetPage.id,
    anchorOffsetRatio: clamp(remoteProgress.anchorOffsetRatio, 0, 1),
    scrollTop: Math.max(remoteProgress.scrollTop, 0),
    scrollRatio: clamp(remoteProgress.scrollRatio, 0, 1),
    pageNumber: targetIndex + 1,
    updatedAt: remoteProgress.updatedAt,
  };
}

function isComicProgressNewer(
  candidate: ComicRemoteReadingProgress,
  current: ComicReaderSnapshot | null | undefined,
): boolean {
  if (!current?.updatedAt) return true;
  const candidateTime = Date.parse(candidate.updatedAt || '');
  const currentTime = Date.parse(current.updatedAt || '');
  if (!Number.isFinite(candidateTime)) return false;
  if (!Number.isFinite(currentTime)) return true;
  return candidateTime > currentTime;
}

const ComicViewer: React.FC<ComicViewerProps> = ({
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
  reloadToken = 0,
}) => {
  const libraryId = useMemo(() => parseComicLibraryId(fileUrl), [fileUrl]);
  const displayTitle = useMemo(() => normalizeComicTitle(fileName), [fileName]);
  const readerCacheKey = useMemo(
    () => resolveReaderCacheKey(fileUrl, folderNodeId, reloadToken),
    [fileUrl, folderNodeId, reloadToken],
  );

  const [pages, setPages] = useState<ComicPageItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [restoreTick, setRestoreTick] = useState(0);
  const [currentPageNumber, setCurrentPageNumber] = useState(0);
  const [layoutMode, setLayoutMode] = useState<ReaderLayoutMode>('scroll');
  const [scrollColumnMode, setScrollColumnMode] = useState<ScrollColumnMode>(1);
  const [scrollZoomScale, setScrollZoomScale] = useState(1);
  const [flipZoomScale, setFlipZoomScale] = useState(1);
  const [flipZoomCustomized, setFlipZoomCustomized] = useState(false);
  const [flipPageIndex, setFlipPageIndex] = useState(0);
  const [flipOffset, setFlipOffset] = useState({ x: 0, y: 0 });
  const [flipRotateSteps, setFlipRotateSteps] = useState(0);
  const [flipDragAnchor, setFlipDragAnchor] = useState({ x: 0, y: 0 });
  const [flipPanMode, setFlipPanMode] = useState(false);
  const [flipDragging, setFlipDragging] = useState(false);
  const [flipMenuState, setFlipMenuState] = useState({
    visible: false,
    x: 0,
    y: 0,
  });
  const [viewerSettingsVisible, setViewerSettingsVisible] = useState(false);
  const [scrollPageGapPx, setScrollPageGapPx] = useState(DEFAULT_SCROLL_PAGE_GAP_PX);
  const scrollRowGap = scrollPageGapPx;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const flipStageRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const flipWarmImageCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const sessionRef = useRef(0);
  const pendingRestoreRef = useRef<{
    desiredScrollTop: number;
    desiredScrollRatio: number;
    anchorPageId: number | null;
    anchorOffsetRatio: number;
    attempts: number;
    lastMaxScrollable: number;
    stableTicks: number;
  } | null>(null);
  const hasLoadedListRef = useRef(false);
  const isHydratingSnapshotRef = useRef(false);
  const scrollPersistRafRef = useRef<number>(0);
  const backTopAnimationRafRef = useRef<number>(0);
  const suppressNextScrollPersistRef = useRef(false);
  const pendingZoomAnchorRef = useRef<{
    anchorPageId: number | null;
    anchorPageIndex: number;
  } | null>(null);
  const lastFocusedPageIdRef = useRef<number | null>(null);
  const viewMetaBaseRef = useRef<Record<string, unknown>>({});
  const remoteProgressSyncTimerRef = useRef<number>(0);
  const remoteProgressSyncInFlightRef = useRef(false);
  const pendingRemoteProgressRef = useRef<ComicRemoteReadingProgress | null>(null);
  const lastSyncedRemoteProgressSignatureRef = useRef<string>('');

  const applyFlipZoomRatio = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }
    setFlipZoomCustomized(true);
    setFlipZoomScale(prev => clamp(prev * ratio, FLIP_ZOOM_MIN, FLIP_ZOOM_MAX));
  }, []);

  const resetFlipZoomToFit = useCallback(() => {
    setFlipZoomCustomized(false);
    setFlipZoomScale(1);
    setFlipOffset({ x: 0, y: 0 });
    setFlipRotateSteps(0);
  }, []);

  const rotateFlipCounterclockwise = useCallback(() => {
    setFlipRotateSteps(prev => (prev + 1) % 4);
  }, []);

  const openViewerSettings = useCallback(() => {
    setViewerSettingsVisible(true);
  }, []);

  const persistReaderSnapshot = useCallback((patch: Partial<ComicReaderSnapshot>) => {
    if (!readerCacheKey) return;
    const prev = comicReaderSnapshotCache.get(readerCacheKey) ?? EMPTY_COMIC_READER_SNAPSHOT;
    setReaderSnapshotCache(readerCacheKey, {
      hasLoadedList: patch.hasLoadedList ?? prev.hasLoadedList,
      pages: patch.pages ?? prev.pages,
      visibleCount: patch.visibleCount ?? prev.visibleCount,
      scrollTop: patch.scrollTop ?? prev.scrollTop,
      scrollRatio: patch.scrollRatio ?? prev.scrollRatio,
      anchorPageId: patch.anchorPageId ?? prev.anchorPageId,
      anchorOffsetRatio: patch.anchorOffsetRatio ?? prev.anchorOffsetRatio,
      updatedAt: patch.updatedAt ?? prev.updatedAt,
    });
  }, [readerCacheKey]);

  const flushRemoteReadingProgress = useCallback(async (force = false) => {
    if (!folderNodeId || !Number.isFinite(folderNodeId)) {
      pendingRemoteProgressRef.current = null;
      return;
    }
    if (!active && !force) {
      return;
    }
    if (remoteProgressSyncInFlightRef.current) {
      return;
    }
    const pending = pendingRemoteProgressRef.current;
    if (!pending) {
      return;
    }

    const signature = [
      pending.anchorPageId ?? 0,
      pending.currentPageNumber,
      pending.anchorOffsetRatio.toFixed(4),
    ].join('|');
    if (signature === lastSyncedRemoteProgressSignatureRef.current) {
      pendingRemoteProgressRef.current = null;
      return;
    }

    remoteProgressSyncInFlightRef.current = true;
    try {
      const nextMeta = buildNextViewMetaWithComicProgress(viewMetaBaseRef.current, pending);
      await updateNodeConfig({
        id: folderNodeId,
        viewMeta: JSON.stringify(nextMeta),
      });
      viewMetaBaseRef.current = nextMeta;
      lastSyncedRemoteProgressSignatureRef.current = signature;
      pendingRemoteProgressRef.current = null;
    } catch (error) {
      runtimeLogger.warn('同步漫画阅读进度失败:', error);
    } finally {
      remoteProgressSyncInFlightRef.current = false;
      if (pendingRemoteProgressRef.current && (active || force)) {
        if (remoteProgressSyncTimerRef.current) {
          window.clearTimeout(remoteProgressSyncTimerRef.current);
        }
        remoteProgressSyncTimerRef.current = window.setTimeout(() => {
          remoteProgressSyncTimerRef.current = 0;
          void flushRemoteReadingProgress();
        }, REMOTE_PROGRESS_SYNC_INTERVAL_MS);
      }
    }
  }, [active, folderNodeId]);

  const queueRemoteReadingProgressSync = useCallback((progress: ComicRemoteReadingProgress) => {
    pendingRemoteProgressRef.current = progress;
    if (!active) {
      return;
    }
    if (remoteProgressSyncTimerRef.current || remoteProgressSyncInFlightRef.current) {
      return;
    }
    remoteProgressSyncTimerRef.current = window.setTimeout(() => {
      remoteProgressSyncTimerRef.current = 0;
      void flushRemoteReadingProgress();
    }, REMOTE_PROGRESS_SYNC_INTERVAL_MS);
  }, [active, flushRemoteReadingProgress]);

  const renderedPages = useMemo(() => pages.slice(0, visibleCount), [pages, visibleCount]);
  const isFlipMode = layoutMode === 'flip';
  const scrollZoomBounds = useMemo(
    () => getScrollZoomBounds(scrollColumnMode),
    [scrollColumnMode],
  );
  const effectiveScrollZoom = useMemo(
    () => clamp(scrollZoomScale, scrollZoomBounds.min, scrollZoomBounds.max),
    [scrollZoomScale, scrollZoomBounds.max, scrollZoomBounds.min],
  );
  const effectiveFlipZoom = useMemo(
    () => clamp(flipZoomScale, FLIP_ZOOM_MIN, FLIP_ZOOM_MAX),
    [flipZoomScale],
  );
  const normalizeFlipIndexForPageMode = useCallback((index: number) => {
    if (scrollColumnMode !== 2) return index;
    return Math.max(Math.floor(index / 2) * 2, 0);
  }, [scrollColumnMode]);

  const captureAnchorSnapshot = useCallback((scrollEl: HTMLDivElement): AnchorSnapshot => {
    if (renderedPages.length === 0) {
      return {
        anchorPageId: null,
        anchorOffsetRatio: 0,
        currentPageNumber: 0,
      };
    }

    const viewportTop = Math.max(scrollEl.scrollTop, 0);
    const measured = renderedPages
      .map((page, index) => {
        const el = pageRefs.current.get(page.id);
        if (!el) return null;
        const top = Math.max(el.offsetTop, 0);
        const height = Math.max(el.offsetHeight, 1);
        return { pageId: page.id, index, top, height, bottom: top + height };
      })
      .filter((item): item is { pageId: number; index: number; top: number; height: number; bottom: number } => Boolean(item));

    if (measured.length === 0) {
      return {
        anchorPageId: renderedPages[0].id,
        anchorOffsetRatio: 0,
        currentPageNumber: 1,
      };
    }

    let active = measured.find(item => viewportTop >= item.top && viewportTop < item.bottom);
    if (!active) {
      active = viewportTop < measured[0].top
        ? measured[0]
        : measured[measured.length - 1];
    }

    const offsetRatio = clamp((viewportTop - active.top) / active.height, 0, 1);
    return {
      anchorPageId: active.pageId,
      anchorOffsetRatio: offsetRatio,
      currentPageNumber: active.index + 1,
    };
  }, [renderedPages]);

  const captureCenterPageSnapshot = useCallback((scrollEl: HTMLDivElement): CenterPageSnapshot => {
    if (renderedPages.length === 0) {
      return {
        pageId: null,
        pageIndex: 0,
      };
    }

    const viewportCenter = scrollEl.scrollTop + scrollEl.clientHeight / 2;
    const measured = renderedPages
      .map((page, index) => {
        const el = pageRefs.current.get(page.id);
        if (!el) return null;
        const top = Math.max(el.offsetTop, 0);
        const height = Math.max(el.offsetHeight, 1);
        const center = top + height / 2;
        return { pageId: page.id, index, distance: Math.abs(center - viewportCenter) };
      })
      .filter((item): item is { pageId: number; index: number; distance: number } => Boolean(item));

    if (measured.length === 0) {
      const fallbackIndex = clamp(Math.max(currentPageNumber - 1, 0), 0, renderedPages.length - 1);
      return {
        pageId: renderedPages[fallbackIndex]?.id ?? null,
        pageIndex: fallbackIndex,
      };
    }

    measured.sort((a, b) => a.distance - b.distance || a.index - b.index);
    const target = measured[0];
    return {
      pageId: target.pageId,
      pageIndex: target.index,
    };
  }, [currentPageNumber, renderedPages]);

  useEffect(() => {
    const currentSession = sessionRef.current + 1;
    sessionRef.current = currentSession;
    pendingRestoreRef.current = null;
    hasLoadedListRef.current = false;
    isHydratingSnapshotRef.current = false;
    viewMetaBaseRef.current = {};
    pendingRemoteProgressRef.current = null;
    lastSyncedRemoteProgressSignatureRef.current = '';
    remoteProgressSyncInFlightRef.current = false;
    if (remoteProgressSyncTimerRef.current) {
      window.clearTimeout(remoteProgressSyncTimerRef.current);
      remoteProgressSyncTimerRef.current = 0;
    }
    setLayoutMode('scroll');
    setScrollColumnMode(1);
    setScrollZoomScale(1);
    setFlipZoomScale(1);
    setFlipZoomCustomized(false);
    setFlipPageIndex(0);
    setFlipOffset({ x: 0, y: 0 });
    setFlipPanMode(false);
    setFlipDragging(false);

    if (!folderNodeId || !Number.isFinite(folderNodeId) || !libraryId || !Number.isFinite(libraryId)) {
      setPages([]);
      setVisibleCount(0);
      setListLoading(false);
      setListError('漫画目录参数异常');
      return;
    }

    const snapshot = readerCacheKey ? comicReaderSnapshotCache.get(readerCacheKey) : null;
    const canRestoreFromSnapshot = Boolean(snapshot?.hasLoadedList && snapshot.pages.length > 0);
    let mounted = true;

    if (canRestoreFromSnapshot && snapshot) {
      isHydratingSnapshotRef.current = true;
      const restoredPages = normalizeCachedPages(snapshot.pages);
      hasLoadedListRef.current = true;
      setListLoading(false);
      setListError(null);
      setPages(restoredPages);

      if (restoredPages.length === 0) {
        setVisibleCount(0);
        setCurrentPageNumber(0);
        pendingRestoreRef.current = null;
      } else {
        const anchorIndex = snapshot.anchorPageId
          ? restoredPages.findIndex(page => page.id === snapshot.anchorPageId)
          : -1;
        const minVisibleCount = anchorIndex >= 0 ? anchorIndex + 1 : 1;
        const restoredVisibleCount = clamp(
          Math.max(snapshot.visibleCount || INITIAL_VISIBLE_COUNT, minVisibleCount),
          1,
          restoredPages.length,
        );
        setVisibleCount(restoredVisibleCount);
        setCurrentPageNumber(anchorIndex >= 0 ? anchorIndex + 1 : 1);
        pendingRestoreRef.current = (snapshot.scrollTop > 0 || snapshot.scrollRatio > 0 || Boolean(snapshot.anchorPageId))
          ? {
            desiredScrollTop: snapshot.scrollTop,
            desiredScrollRatio: snapshot.scrollRatio,
            anchorPageId: snapshot.anchorPageId,
            anchorOffsetRatio: snapshot.anchorOffsetRatio,
            attempts: 0,
            lastMaxScrollable: 0,
            stableTicks: 0,
          }
          : null;
        if (pendingRestoreRef.current) {
          setRestoreTick(prev => prev + 1);
        }
      }

      // Re-persist once to clear stale "loading" markers from cached pages.
      persistReaderSnapshot({ hasLoadedList: true, pages: restoredPages });
      const loadRemoteProgress = async () => {
        try {
          const detail = await fetchNodeDetailById(folderNodeId);
          if (!mounted || sessionRef.current !== currentSession) {
            return;
          }
          viewMetaBaseRef.current = parseViewMetaObject(detail?.viewMeta);
          const remoteProgress = parseComicRemoteReadingProgress(detail?.viewMeta);
          if (!remoteProgress || restoredPages.length === 0) {
            return;
          }
          if (!isComicProgressNewer(remoteProgress, snapshot)) {
            return;
          }
          const restoreTarget = resolveRemoteRestoreTarget(restoredPages, remoteProgress);
          if (!restoreTarget) {
            return;
          }
          const minVisibleCount = restoreTarget.pageNumber;
          const restoredVisibleCount = clamp(
            Math.max(snapshot.visibleCount || INITIAL_VISIBLE_COUNT, minVisibleCount),
            1,
            restoredPages.length,
          );
          setVisibleCount(restoredVisibleCount);
          setCurrentPageNumber(restoreTarget.pageNumber);
          pendingRestoreRef.current = {
            desiredScrollTop: restoreTarget.scrollTop,
            desiredScrollRatio: restoreTarget.scrollRatio,
            anchorPageId: restoreTarget.anchorPageId,
            anchorOffsetRatio: restoreTarget.anchorOffsetRatio,
            attempts: 0,
            lastMaxScrollable: 0,
            stableTicks: 0,
          };
          setRestoreTick(prev => prev + 1);
        } catch (error) {
          runtimeLogger.warn('加载漫画阅读记录失败，将使用本地记录:', error);
        }
      };

      void loadRemoteProgress();
      return () => {
        mounted = false;
      };
    }

    setListLoading(true);
    setListError(null);
    setPages([]);
    setVisibleCount(0);

    const loadComicList = async () => {
      try {
        const [children, detail] = await Promise.all([
          getChildrenByNodeId(folderNodeId, libraryId) as Promise<ComicChildNode[]>,
          fetchNodeDetailById(folderNodeId).catch((error) => {
            runtimeLogger.warn('加载漫画节点详情失败:', error);
            return null;
          }),
        ]);
        if (!mounted || sessionRef.current !== currentSession) {
          return;
        }
        viewMetaBaseRef.current = parseViewMetaObject(detail?.viewMeta);
        const remoteProgress = parseComicRemoteReadingProgress(detail?.viewMeta);
        const imagePages = children
          .filter(isImageNode)
          .map((item: ComicChildNode) => ({
            id: item.id,
            name: item.name,
            ext: item.ext,
            mimeType: item.mimeType,
            url: null,
            status: 'idle' as const,
          }));
        hasLoadedListRef.current = true;
        const initialVisibleCount = imagePages.length === 0
          ? 0
          : Math.min(INITIAL_VISIBLE_COUNT, imagePages.length);
        const remoteRestoreTarget = remoteProgress
          ? resolveRemoteRestoreTarget(imagePages, remoteProgress)
          : null;
        const restoredVisibleCount = remoteRestoreTarget
          ? clamp(Math.max(initialVisibleCount, remoteRestoreTarget.pageNumber), 1, imagePages.length)
          : initialVisibleCount;
        setPages(imagePages);
        setVisibleCount(restoredVisibleCount);
        setCurrentPageNumber(
          remoteRestoreTarget
            ? remoteRestoreTarget.pageNumber
            : (imagePages.length > 0 ? 1 : 0),
        );
        pendingRestoreRef.current = remoteRestoreTarget
          ? {
            desiredScrollTop: remoteRestoreTarget.scrollTop,
            desiredScrollRatio: remoteRestoreTarget.scrollRatio,
            anchorPageId: remoteRestoreTarget.anchorPageId,
            anchorOffsetRatio: remoteRestoreTarget.anchorOffsetRatio,
            attempts: 0,
            lastMaxScrollable: 0,
            stableTicks: 0,
          }
          : null;
        if (pendingRestoreRef.current) {
          setRestoreTick(prev => prev + 1);
        }
        persistReaderSnapshot({
          hasLoadedList: true,
          pages: imagePages,
          visibleCount: restoredVisibleCount,
          scrollTop: 0,
          scrollRatio: 0,
          anchorPageId: remoteRestoreTarget?.anchorPageId ?? (imagePages.length > 0 ? imagePages[0].id : null),
          anchorOffsetRatio: remoteRestoreTarget?.anchorOffsetRatio ?? 0,
          updatedAt: remoteRestoreTarget?.updatedAt ?? '',
        });
      } catch (error) {
        runtimeLogger.error('加载漫画列表失败:', error);
        if (!mounted || sessionRef.current !== currentSession) {
          return;
        }
        setListError('加载漫画目录失败');
      } finally {
        if (mounted && sessionRef.current === currentSession) {
          setListLoading(false);
        }
      }
    };

    void loadComicList();
    return () => {
      mounted = false;
    };
  }, [folderNodeId, libraryId, readerCacheKey, persistReaderSnapshot]);

  useEffect(() => {
    const validPageIds = new Set(renderedPages.map(page => page.id));
    const refs = pageRefs.current;
    Array.from(refs.keys()).forEach((id) => {
      if (!validPageIds.has(id)) {
        refs.delete(id);
      }
    });
  }, [renderedPages]);

  useEffect(() => {
    setScrollZoomScale(prev => clamp(prev, scrollZoomBounds.min, scrollZoomBounds.max));
  }, [scrollZoomBounds.max, scrollZoomBounds.min]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setScrollWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(scrollEl);
    setScrollWidth(Math.round(scrollEl.clientWidth));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasLoadedListRef.current) return;
    if (isHydratingSnapshotRef.current) return;
    persistReaderSnapshot({ hasLoadedList: true, visibleCount });
  }, [persistReaderSnapshot, visibleCount]);

  useEffect(() => {
    if (!isFlipMode) return;
    if (pages.length === 0) return;
    const requiredVisible = Math.min(
      Math.max(flipPageIndex + PREFETCH_AHEAD + 1, 1),
      pages.length,
    );
    if (requiredVisible > visibleCount) {
      setVisibleCount(requiredVisible);
    }
  }, [flipPageIndex, isFlipMode, pages.length, visibleCount]);

  useEffect(() => {
    if (!hasLoadedListRef.current) return;
    if (isHydratingSnapshotRef.current) return;
    persistReaderSnapshot({ hasLoadedList: true, pages });
  }, [pages, persistReaderSnapshot]);

  useEffect(() => {
    if (!isHydratingSnapshotRef.current) return;
    if (!hasLoadedListRef.current) return;
    if (pages.length === 0) return;
    isHydratingSnapshotRef.current = false;
    persistReaderSnapshot({
      hasLoadedList: true,
      pages,
      visibleCount,
    });
  }, [pages, persistReaderSnapshot, visibleCount]);

  const persistCurrentScroll = useCallback((options?: { forceRemoteNow?: boolean }) => {
    if (!readerCacheKey) return;
    if (!hasLoadedListRef.current) return;
    if (isHydratingSnapshotRef.current) return;
    const updatedAt = new Date().toISOString();
    if (isFlipMode) {
      if (pages.length === 0) return;
      const safeIndex = normalizeFlipIndexForPageMode(clamp(flipPageIndex, 0, pages.length - 1));
      const currentPage = pages[safeIndex];
      if (!currentPage) return;
      lastFocusedPageIdRef.current = currentPage.id;
      const pageNumber = safeIndex + 1;
      setCurrentPageNumber(pageNumber);
      persistReaderSnapshot({
        hasLoadedList: true,
        scrollTop: 0,
        scrollRatio: 0,
        anchorPageId: currentPage.id,
        anchorOffsetRatio: 0,
        updatedAt,
      });
      if (active) {
        queueRemoteReadingProgressSync({
          anchorPageId: currentPage.id,
          anchorOffsetRatio: 0,
          scrollTop: 0,
          scrollRatio: 0,
          currentPageNumber: pageNumber,
          updatedAt,
        });
        if (options?.forceRemoteNow) {
          if (remoteProgressSyncTimerRef.current) {
            window.clearTimeout(remoteProgressSyncTimerRef.current);
            remoteProgressSyncTimerRef.current = 0;
          }
          void flushRemoteReadingProgress(true);
        }
      }
      return;
    }

    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const scrollTop = Math.max(scrollEl.scrollTop, 0);
    const maxScrollable = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0);
    const scrollRatio = maxScrollable > 0
      ? clamp(scrollTop / maxScrollable, 0, 1)
      : 0;
    const anchorSnapshot = captureAnchorSnapshot(scrollEl);
    lastFocusedPageIdRef.current = anchorSnapshot.anchorPageId;
    setCurrentPageNumber(anchorSnapshot.currentPageNumber);
    persistReaderSnapshot({
      hasLoadedList: true,
      scrollTop,
      scrollRatio,
      anchorPageId: anchorSnapshot.anchorPageId,
      anchorOffsetRatio: anchorSnapshot.anchorOffsetRatio,
      updatedAt,
    });
    if (active) {
      queueRemoteReadingProgressSync({
        anchorPageId: anchorSnapshot.anchorPageId,
        anchorOffsetRatio: anchorSnapshot.anchorOffsetRatio,
        scrollTop,
        scrollRatio,
        currentPageNumber: anchorSnapshot.currentPageNumber,
        updatedAt,
      });
      if (options?.forceRemoteNow) {
        if (remoteProgressSyncTimerRef.current) {
          window.clearTimeout(remoteProgressSyncTimerRef.current);
          remoteProgressSyncTimerRef.current = 0;
        }
        void flushRemoteReadingProgress(true);
      }
    }
  }, [
    active,
    captureAnchorSnapshot,
    flipPageIndex,
    flushRemoteReadingProgress,
    isFlipMode,
    normalizeFlipIndexForPageMode,
    pages,
    persistReaderSnapshot,
    queueRemoteReadingProgressSync,
    readerCacheKey,
  ]);

  useEffect(() => {
    return () => {
      if (scrollPersistRafRef.current) {
        window.cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = 0;
      }
      if (backTopAnimationRafRef.current) {
        window.cancelAnimationFrame(backTopAnimationRafRef.current);
        backTopAnimationRafRef.current = 0;
      }
      persistCurrentScroll();
      if (remoteProgressSyncTimerRef.current) {
        window.clearTimeout(remoteProgressSyncTimerRef.current);
        remoteProgressSyncTimerRef.current = 0;
      }
      void flushRemoteReadingProgress(true);
    };
  }, [flushRemoteReadingProgress, persistCurrentScroll]);

  const handleScroll = useCallback(() => {
    if (isFlipMode) return;
    if (suppressNextScrollPersistRef.current) {
      suppressNextScrollPersistRef.current = false;
      return;
    }
    if (scrollPersistRafRef.current) return;
    scrollPersistRafRef.current = window.requestAnimationFrame(() => {
      scrollPersistRafRef.current = 0;
      persistCurrentScroll();
    });
  }, [isFlipMode, persistCurrentScroll]);

  const handleBackToTop = useCallback(() => {
    if (isFlipMode) {
      setFlipPageIndex(0);
      setFlipOffset({ x: 0, y: 0 });
      persistCurrentScroll({ forceRemoteNow: true });
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (scrollPersistRafRef.current) {
      window.cancelAnimationFrame(scrollPersistRafRef.current);
      scrollPersistRafRef.current = 0;
    }
    if (backTopAnimationRafRef.current) {
      window.cancelAnimationFrame(backTopAnimationRafRef.current);
      backTopAnimationRafRef.current = 0;
    }
    if (pages.length > BACK_TO_TOP_DIRECT_PAGE_THRESHOLD) {
      scrollEl.scrollTop = 0;
      persistCurrentScroll({ forceRemoteNow: true });
      return;
    }

    const startTop = Math.max(scrollEl.scrollTop, 0);
    if (startTop <= 1) {
      persistCurrentScroll({ forceRemoteNow: true });
      return;
    }
    const duration = clamp(
      startTop / 10,
      BACK_TO_TOP_ANIMATION_MIN_MS,
      BACK_TO_TOP_ANIMATION_MAX_MS,
    );
    const startAt = performance.now();

    const step = (now: number) => {
      const progress = clamp((now - startAt) / duration, 0, 1);
      const eased = easeOutCubic(progress);
      scrollEl.scrollTop = Math.max(startTop * (1 - eased), 0);
      if (progress < 1) {
        backTopAnimationRafRef.current = window.requestAnimationFrame(step);
        return;
      }
      backTopAnimationRafRef.current = 0;
      scrollEl.scrollTop = 0;
      persistCurrentScroll({ forceRemoteNow: true });
    };

    backTopAnimationRafRef.current = window.requestAnimationFrame(step);
  }, [isFlipMode, pages.length, persistCurrentScroll]);

  useEffect(() => {
    if (active) return;
    if (!backTopAnimationRafRef.current) return;
    window.cancelAnimationFrame(backTopAnimationRafRef.current);
    backTopAnimationRafRef.current = 0;
  }, [active]);

  useEffect(() => {
    if (active) {
      return;
    }
    void flushRemoteReadingProgress(true);
  }, [active, flushRemoteReadingProgress]);

  useEffect(() => {
    if (isFlipMode) return;
    const scrollEl = scrollRef.current;
    const sentinelEl = sentinelRef.current;
    if (!scrollEl || !sentinelEl) return;
    if (visibleCount >= pages.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setVisibleCount((prev) => Math.min(prev + LOAD_MORE_STEP, pages.length));
      },
      {
        root: scrollEl,
        threshold: 0.01,
        rootMargin: '1200px 0px',
      },
    );

    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [isFlipMode, pages.length, visibleCount]);

  useEffect(() => {
    if (!folderNodeId || !libraryId || !Number.isFinite(libraryId)) return;
    const prefetchLimit = Math.min(visibleCount + PREFETCH_AHEAD, pages.length);
    if (prefetchLimit <= 0) return;

    const targets = pages
      .map((page, index) => ({ page, index }))
      .filter(({ page, index }) => index < prefetchLimit && page.status === 'idle')
      .slice(0, MAX_RESOLVE_PER_TICK);

    if (targets.length === 0) return;

    const currentSession = sessionRef.current;
    setPages((prev) => prev.map((page, index) => (
      targets.some((target) => target.index === index)
        ? { ...page, status: 'loading' as const }
        : page
    )));

    const resolveLinks = async () => {
      const targetNodeIds = targets.map(({ page }) => page.id);
      let linkMap = new Map<number, string>();
      try {
        linkMap = await batchGetFileLinks({
          libraryId,
          nodeIds: targetNodeIds,
          expiry: COMIC_LINK_EXPIRY_MINUTES,
        });
      } catch (error) {
        runtimeLogger.error('批量加载漫画页链接失败:', error);
      }

      if (sessionRef.current !== currentSession) {
        return;
      }

      const targetIndexMap = new Map<number, number>(
        targets.map(({ index, page }) => [page.id, index]),
      );

      setPages((prev) => prev.map((page, index) => {
        const targetIndex = targetIndexMap.get(page.id);
        if (targetIndex === undefined || targetIndex !== index) return page;
        const nextUrl = linkMap.get(page.id);
        if (nextUrl) {
          return { ...page, status: 'ready', url: nextUrl };
        }
        return { ...page, status: 'error', url: null };
      }));
    };

    void resolveLinks();
  }, [folderNodeId, libraryId, pages, visibleCount]);

  const scrollBasePageWidth = useMemo(() => {
    if (!scrollWidth) return 760;
    if (scrollColumnMode === 2) {
      const raw = (scrollWidth - 32 - DOUBLE_COLUMN_INNER_GAP) / 2;
      return clamp(raw, MIN_PAGE_WIDTH * 0.7, MAX_PAGE_WIDTH);
    }
    return clamp(scrollWidth - 32, MIN_PAGE_WIDTH, MAX_PAGE_WIDTH);
  }, [scrollColumnMode, scrollWidth]);

  const pageWidth = useMemo(
    () => Math.round(scrollBasePageWidth * effectiveScrollZoom),
    [effectiveScrollZoom, scrollBasePageWidth],
  );

  const gridWidth = useMemo(() => {
    if (scrollColumnMode === 2) {
      return Math.max(pageWidth * 2 + DOUBLE_COLUMN_INNER_GAP, 0);
    }
    return pageWidth;
  }, [pageWidth, scrollColumnMode]);

  useEffect(() => {
    if (isFlipMode) return;
    const pending = pendingRestoreRef.current;
    const scrollEl = scrollRef.current;
    if (!pending || !scrollEl) return;

    const maxScrollable = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0);
    let targetTop = 0;

    if (pending.anchorPageId) {
      const anchorEl = pageRefs.current.get(pending.anchorPageId);
      if (anchorEl) {
        const offset = clamp(pending.anchorOffsetRatio, 0, 1) * Math.max(anchorEl.offsetHeight, 1);
        targetTop = Math.max(anchorEl.offsetTop + offset, 0);
      }
    }

    if (targetTop <= 0) {
      const ratioTarget = pending.desiredScrollRatio > 0
        ? pending.desiredScrollRatio * maxScrollable
        : 0;
      targetTop = Math.max(pending.desiredScrollTop, ratioTarget, 0);
    }

    targetTop = Math.min(targetTop, maxScrollable);
    scrollEl.scrollTop = targetTop;

    const reachedDesiredPosition = Math.abs(scrollEl.scrollTop - targetTop) <= 1;
    const growthDelta = Math.abs(maxScrollable - pending.lastMaxScrollable);
    pending.lastMaxScrollable = maxScrollable;
    if (growthDelta <= 8) {
      pending.stableTicks += 1;
    } else {
      pending.stableTicks = 0;
    }

    if ((reachedDesiredPosition && pending.stableTicks >= 4) || pending.attempts >= 60) {
      const finalTop = Math.max(scrollEl.scrollTop, 0);
      const finalMaxScrollable = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0);
      const finalRatio = finalMaxScrollable > 0
        ? clamp(finalTop / finalMaxScrollable, 0, 1)
        : 0;
      const anchorSnapshot = captureAnchorSnapshot(scrollEl);
      setCurrentPageNumber(anchorSnapshot.currentPageNumber);
      pendingRestoreRef.current = null;
      persistReaderSnapshot({
        hasLoadedList: true,
        scrollTop: finalTop,
        scrollRatio: finalRatio,
        anchorPageId: anchorSnapshot.anchorPageId,
        anchorOffsetRatio: anchorSnapshot.anchorOffsetRatio,
      });
      return;
    }

    pending.attempts += 1;
    const timer = window.setTimeout(() => {
      setRestoreTick(prev => prev + 1);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [captureAnchorSnapshot, isFlipMode, persistReaderSnapshot, renderedPages.length, restoreTick]);

  useEffect(() => {
    if (!active) return;
    if (isFlipMode) return;
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      setScrollWidth(Math.round(scrollEl.clientWidth));
    }
    if (!readerCacheKey || pages.length === 0) {
      return;
    }
    if (pendingRestoreRef.current) {
      return;
    }
    const snapshot = comicReaderSnapshotCache.get(readerCacheKey);
    if (!snapshot) {
      return;
    }
    pendingRestoreRef.current = (snapshot.scrollTop > 0 || snapshot.scrollRatio > 0 || Boolean(snapshot.anchorPageId))
      ? {
        desiredScrollTop: snapshot.scrollTop,
        desiredScrollRatio: snapshot.scrollRatio,
        anchorPageId: snapshot.anchorPageId,
        anchorOffsetRatio: snapshot.anchorOffsetRatio,
        attempts: 0,
        lastMaxScrollable: 0,
        stableTicks: 0,
      }
      : null;
    if (pendingRestoreRef.current) {
      setRestoreTick(prev => prev + 1);
    }
  }, [active, isFlipMode, pages.length, readerCacheKey]);

  const primeScrollZoomAnchor = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl && renderedPages.length > 0) {
      const centerPage = captureCenterPageSnapshot(scrollEl);
      pendingZoomAnchorRef.current = {
        anchorPageId: centerPage.pageId,
        anchorPageIndex: centerPage.pageIndex,
      };
      if (centerPage.pageIndex + 1 > visibleCount) {
        setVisibleCount(centerPage.pageIndex + 1);
      }
    } else {
      pendingZoomAnchorRef.current = null;
    }
  }, [captureCenterPageSnapshot, renderedPages.length, visibleCount]);

  const zoomScrollByDirection = useCallback((direction: 1 | -1) => {
    primeScrollZoomAnchor();
    const next = scrollZoomScale * (1 + direction * CTRL_WHEEL_ZOOM_STEP);
    setScrollZoomScale(clamp(next, scrollZoomBounds.min, scrollZoomBounds.max));
  }, [
    primeScrollZoomAnchor,
    scrollZoomBounds.max,
    scrollZoomBounds.min,
    scrollZoomScale,
  ]);

  const resetScrollZoom = useCallback(() => {
    primeScrollZoomAnchor();
    setScrollZoomScale(1);
  }, [
    primeScrollZoomAnchor,
  ]);

  const viewerMenuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [];
    if (isFlipMode) {
      items.push({
        key: 'reset-view',
        label: '重制视图',
        onClick: resetFlipZoomToFit,
      });
      if (scrollColumnMode === 1) {
        items.push({
          key: 'rotate-ccw-90',
          label: '旋转（逆时针90°）',
          onClick: rotateFlipCounterclockwise,
        });
      }
    } else {
      items.push({
        key: 'reset-view',
        label: '重制视图',
        onClick: resetScrollZoom,
      });
    }
    items.push({ key: 'd-settings', type: 'divider' });
    items.push({
      key: 'viewer-settings',
      label: '设置',
      onClick: openViewerSettings,
    });
    return items;
  }, [isFlipMode, openViewerSettings, resetFlipZoomToFit, resetScrollZoom, rotateFlipCounterclockwise, scrollColumnMode]);

  useEffect(() => {
    if (isFlipMode) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleNativeWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
    };

    scrollEl.addEventListener('wheel', handleNativeWheel, { passive: false, capture: true });
    return () => {
      scrollEl.removeEventListener('wheel', handleNativeWheel, { capture: true } as EventListenerOptions);
    };
  }, [isFlipMode]);

  const handleFlipWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    applyFlipZoomRatio(1 + direction * CTRL_WHEEL_ZOOM_STEP);
  }, [applyFlipZoomRatio]);

  const goToPrevFlipPage = useCallback(() => {
    if (pages.length === 0) return;
    const step = scrollColumnMode === 2 ? 2 : 1;
    setFlipPageIndex(prev => {
      const normalized = normalizeFlipIndexForPageMode(prev);
      return clamp(normalized - step, 0, pages.length - 1);
    });
    setFlipOffset({ x: 0, y: 0 });
  }, [normalizeFlipIndexForPageMode, pages.length, scrollColumnMode]);

  const goToNextFlipPage = useCallback(() => {
    if (pages.length === 0) return;
    const step = scrollColumnMode === 2 ? 2 : 1;
    setFlipPageIndex(prev => {
      const normalized = normalizeFlipIndexForPageMode(prev);
      return clamp(normalized + step, 0, pages.length - 1);
    });
    setFlipOffset({ x: 0, y: 0 });
  }, [normalizeFlipIndexForPageMode, pages.length, scrollColumnMode]);

  const toggleScrollColumnMode = useCallback(() => {
    if (pages.length === 0) return;
    setScrollColumnMode(prev => {
      const nextMode: ScrollColumnMode = prev === 1 ? 2 : 1;
      if (isFlipMode) {
        setFlipPageIndex(current => {
          const safe = clamp(current, 0, pages.length - 1);
          if (nextMode === 2) {
            return Math.max(Math.floor(safe / 2) * 2, 0);
          }
          return safe;
        });
      }
      return nextMode;
    });
    if (isFlipMode && !flipZoomCustomized) {
      setFlipZoomScale(1);
    }
  }, [flipZoomCustomized, isFlipMode, pages.length]);

  const toggleLayoutMode = useCallback(() => {
    if (pages.length === 0) return;
    if (layoutMode === 'flip') {
      setLayoutMode('scroll');
      const restoreIndex = clamp(Math.max(flipPageIndex, 0), 0, pages.length - 1);
      const restorePage = pages[restoreIndex];
      if (restorePage) {
        lastFocusedPageIdRef.current = restorePage.id;
        const nextVisibleCount = clamp(Math.max(visibleCount, restoreIndex + 1), 1, pages.length);
        setVisibleCount(nextVisibleCount);
        pendingRestoreRef.current = {
          desiredScrollTop: 0,
          desiredScrollRatio: 0,
          anchorPageId: restorePage.id,
          anchorOffsetRatio: 0,
          attempts: 0,
          lastMaxScrollable: 0,
          stableTicks: 0,
        };
        setRestoreTick(prev => prev + 1);
      }
      return;
    }

    const scrollEl = scrollRef.current;
    const pageNumberBasedIndex = clamp(Math.max(currentPageNumber - 1, 0), 0, pages.length - 1);
    let safeTargetIndex = pageNumberBasedIndex;
    if (lastFocusedPageIdRef.current) {
      const focusedIndex = pages.findIndex(page => page.id === lastFocusedPageIdRef.current);
      if (focusedIndex >= 0) {
        safeTargetIndex = focusedIndex;
      }
    } else if (scrollEl) {
      const snapshot = captureAnchorSnapshot(scrollEl);
      const targetIndex = snapshot.currentPageNumber > 0
        ? snapshot.currentPageNumber - 1
        : 0;
      safeTargetIndex = clamp(targetIndex, 0, pages.length - 1);
    }

    const focusedPage = pages[safeTargetIndex];
    if (focusedPage) {
      lastFocusedPageIdRef.current = focusedPage.id;
    }
    setFlipPageIndex(normalizeFlipIndexForPageMode(safeTargetIndex));
    setVisibleCount(prev => Math.max(prev, safeTargetIndex + 1));
    setLayoutMode('flip');
    if (!flipZoomCustomized) {
      setFlipZoomScale(1);
    }
    setFlipOffset({ x: 0, y: 0 });
  }, [
    captureAnchorSnapshot,
    currentPageNumber,
    flipZoomCustomized,
    layoutMode,
    normalizeFlipIndexForPageMode,
    pages,
    flipPageIndex,
    visibleCount,
  ]);

  const handleFlipMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (flipPanMode || event.button === 1) {
      event.preventDefault();
      setFlipDragging(true);
      setFlipDragAnchor({
        x: event.clientX - flipOffset.x,
        y: event.clientY - flipOffset.y,
      });
    }
  }, [flipOffset.x, flipOffset.y, flipPanMode]);

  const handleFlipMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!flipDragging) return;
    setFlipOffset({
      x: event.clientX - flipDragAnchor.x,
      y: event.clientY - flipDragAnchor.y,
    });
  }, [flipDragAnchor.x, flipDragAnchor.y, flipDragging]);

  const handleFlipMouseUp = useCallback(() => {
    setFlipDragging(false);
  }, []);

  const handleViewerContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextPosition = { x: event.clientX, y: event.clientY };

    if (flipMenuState.visible) {
      setFlipMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setFlipMenuState({ ...nextPosition, visible: true });
      }, 0);
      return;
    }
    setFlipMenuState({ ...nextPosition, visible: true });
  }, [flipMenuState.visible]);

  const handleFlipStageClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isFlipMode) return;
    if (flipPanMode || flipDragging) return;
    if (event.button !== 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relativeX = event.clientX - rect.left;
    const zoneWidth = rect.width / 3;

    if (relativeX < zoneWidth) {
      goToPrevFlipPage();
      return;
    }
    if (relativeX > zoneWidth * 2) {
      goToNextFlipPage();
    }
  }, [flipDragging, flipPanMode, goToNextFlipPage, goToPrevFlipPage, isFlipMode]);

  useEffect(() => {
    if (!isFlipMode) {
      setFlipPanMode(false);
      setFlipDragging(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        setFlipPanMode(true);
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        goToPrevFlipPage();
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        goToNextFlipPage();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setFlipPanMode(false);
        setFlipDragging(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [goToNextFlipPage, goToPrevFlipPage, isFlipMode]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const handleZoomShortcut = (event: KeyboardEvent) => {
      if (!active) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isEditableTarget(event.target)) return;

      const code = event.code;
      const key = event.key;
      const isPlus = key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd';
      const isMinus = key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract';
      const isReset = key === '0' || code === 'Digit0' || code === 'Numpad0';
      if (!isPlus && !isMinus && !isReset) return;

      event.preventDefault();
      event.stopPropagation();

      if (isPlus) {
        if (isFlipMode) {
          applyFlipZoomRatio(1 + CTRL_WHEEL_ZOOM_STEP);
        } else {
          zoomScrollByDirection(1);
        }
        return;
      }

      if (isMinus) {
        if (isFlipMode) {
          applyFlipZoomRatio(1 - CTRL_WHEEL_ZOOM_STEP);
        } else {
          zoomScrollByDirection(-1);
        }
        return;
      }

      if (isFlipMode) {
        resetFlipZoomToFit();
      } else {
        resetScrollZoom();
      }
    };

    window.addEventListener('keydown', handleZoomShortcut, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleZoomShortcut, { capture: true } as EventListenerOptions);
    };
  }, [active, applyFlipZoomRatio, isFlipMode, resetFlipZoomToFit, resetScrollZoom, zoomScrollByDirection]);

  const flipPrimaryIndex = useMemo(
    () => normalizeFlipIndexForPageMode(clamp(flipPageIndex, 0, Math.max(pages.length - 1, 0))),
    [flipPageIndex, normalizeFlipIndexForPageMode, pages.length],
  );
  const flipDisplayPages = useMemo(() => {
    if (pages.length === 0) return [] as Array<ComicPageItem | null>;
    const primary = pages[flipPrimaryIndex] ?? null;
    if (scrollColumnMode === 2) {
      const secondary = pages[flipPrimaryIndex + 1] ?? null;
      return [primary, secondary];
    }
    return [primary];
  }, [flipPrimaryIndex, pages, scrollColumnMode]);

  useEffect(() => {
    if (!isFlipMode || pages.length === 0) {
      flipWarmImageCacheRef.current.clear();
      return;
    }

    const start = Math.max(flipPrimaryIndex - FLIP_DECODE_WINDOW_BEHIND, 0);
    const end = Math.min(flipPrimaryIndex + FLIP_DECODE_WINDOW_AHEAD, pages.length - 1);
    const keepIds = new Set<number>();

    for (let i = start; i <= end; i += 1) {
      const page = pages[i];
      if (!page || page.status !== 'ready' || !page.url) {
        continue;
      }
      keepIds.add(page.id);
      if (flipWarmImageCacheRef.current.has(page.id)) {
        continue;
      }
      const image = new Image();
      image.decoding = 'async';
      image.src = page.url;
      flipWarmImageCacheRef.current.set(page.id, image);
    }

    Array.from(flipWarmImageCacheRef.current.keys()).forEach((id) => {
      if (!keepIds.has(id)) {
        flipWarmImageCacheRef.current.delete(id);
      }
    });
  }, [flipPrimaryIndex, isFlipMode, pages]);

  useEffect(() => {
    if (!isFlipMode) return;
    if (pages.length === 0) return;
    if (!active) return;
    persistCurrentScroll();
  }, [active, flipPageIndex, isFlipMode, pages.length, persistCurrentScroll]);

  useEffect(() => {
    if (!isFlipMode) return;
    setFlipOffset({ x: 0, y: 0 });
    setFlipRotateSteps(0);
  }, [flipPageIndex, isFlipMode]);

  useEffect(() => {
    if (!isFlipMode) return;
    if (scrollColumnMode === 2 && flipRotateSteps !== 0) {
      setFlipRotateSteps(0);
    }
  }, [flipRotateSteps, isFlipMode, scrollColumnMode]);

  useEffect(() => {
    if (isFlipMode) return;
    setFlipMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
  }, [isFlipMode]);

  useEffect(() => {
    if (!isFlipMode) return;
    if (pages.length === 0) {
      setCurrentPageNumber(0);
      return;
    }
    if (flipPrimaryIndex > pages.length - 1) {
      setFlipPageIndex(pages.length - 1);
      return;
    }
    if (scrollColumnMode === 2 && flipPageIndex !== flipPrimaryIndex) {
      setFlipPageIndex(flipPrimaryIndex);
      return;
    }
    lastFocusedPageIdRef.current = pages[flipPrimaryIndex]?.id ?? null;
    setCurrentPageNumber(clamp(flipPrimaryIndex + 1, 1, pages.length));
  }, [flipPageIndex, flipPrimaryIndex, isFlipMode, pages, scrollColumnMode]);

  useEffect(() => {
    if (isFlipMode) return;
    const pending = pendingZoomAnchorRef.current;
    if (!pending) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      pendingZoomAnchorRef.current = null;
      return;
    }

    const applyAnchor = () => {
      const latest = pendingZoomAnchorRef.current;
      if (!latest) return;

      let anchorEl: HTMLElement | null = null;
      if (latest.anchorPageId) {
        anchorEl = pageRefs.current.get(latest.anchorPageId) ?? null;
      }
      if (!anchorEl && renderedPages.length > 0) {
        const fallbackPage = renderedPages[clamp(latest.anchorPageIndex, 0, renderedPages.length - 1)];
        if (fallbackPage) {
          anchorEl = pageRefs.current.get(fallbackPage.id) ?? null;
        }
      }
      if (!anchorEl) {
        pendingZoomAnchorRef.current = null;
        return;
      }

      const pageCenter = anchorEl.offsetTop + anchorEl.offsetHeight / 2;
      const targetTop = pageCenter - scrollEl.clientHeight / 2;
      const maxScrollable = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0);
      suppressNextScrollPersistRef.current = true;
      scrollEl.scrollTop = clamp(targetTop, 0, maxScrollable);
      pendingZoomAnchorRef.current = null;
    };

    const rafId = window.requestAnimationFrame(applyAnchor);
    return () => window.cancelAnimationFrame(rafId);
  }, [effectiveScrollZoom, isFlipMode, pageWidth, renderedPages, scrollColumnMode, visibleCount]);

  if (listLoading) {
    return (
      <ComicViewerWrapper>
        <div className="state-empty">
          <Spin size="large" tip="漫画目录加载中..." />
        </div>
      </ComicViewerWrapper>
    );
  }

  if (listError) {
    return (
      <ComicViewerWrapper>
        <div className="state-error">{listError}</div>
      </ComicViewerWrapper>
    );
  }

  if (pages.length === 0) {
    return (
      <ComicViewerWrapper>
        <div className="state-empty">该目录下没有可预览的图片</div>
      </ComicViewerWrapper>
    );
  }

  const layoutModeSwitchLabel = isFlipMode ? '滚动模式' : '翻页模式';
  const pageModeSwitchLabel = scrollColumnMode === 1 ? '双页' : '单页';
  const pageGap = scrollRowGap;

  return (
    <ComicViewerWrapper>
      {isFlipMode ? (
        <div
          className={`flip-stage ${flipPanMode ? 'can-pan' : ''} ${flipDragging ? 'is-panning' : ''}`}
          ref={flipStageRef}
          onClick={handleFlipStageClick}
          onContextMenu={handleViewerContextMenu}
          onWheel={handleFlipWheel}
          onMouseDown={handleFlipMouseDown}
          onMouseMove={handleFlipMouseMove}
          onMouseUp={handleFlipMouseUp}
          onMouseLeave={handleFlipMouseUp}
        >
          <div className={`flip-canvas ${scrollColumnMode === 2 ? 'double' : 'single'}`}>
            {flipDisplayPages.map((page, index) => (
              <div className="flip-page-panel" key={`flip-page-${index}`}>
                {page?.status === 'ready' && page.url ? (
                  <img
                    className="flip-image"
                    src={page.url}
                    alt={page.name}
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    style={{
                      transform: `translate(${flipOffset.x}px, ${flipOffset.y}px) scale(${effectiveFlipZoom}) rotate(${-90 * flipRotateSteps}deg)`,
                    }}
                  />
                ) : page ? (
                  <div className="flip-image-skeleton">
                    {page.status === 'error' ? '加载失败' : <Spin size="middle" />}
                  </div>
                ) : (
                  <div className="flip-image-empty" />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="pages-scroll" ref={scrollRef} onScroll={handleScroll} onContextMenu={handleViewerContextMenu}>
          <div
            className={`pages-grid column-${scrollColumnMode}`}
            style={{
              width: `${gridWidth}px`,
              gridTemplateColumns: `repeat(${scrollColumnMode}, minmax(0, ${pageWidth}px))`,
              columnGap: `${scrollColumnMode === 2 ? DOUBLE_COLUMN_INNER_GAP : 0}px`,
              rowGap: `${pageGap}px`,
            }}
          >
            {renderedPages.map((page) => (
              <article
                className="page-shell"
                style={{ width: `${pageWidth}px` }}
                key={page.id}
                ref={(el) => {
                  if (el) {
                    pageRefs.current.set(page.id, el);
                  } else {
                    pageRefs.current.delete(page.id);
                  }
                }}
              >
                {page.status === 'ready' && page.url ? (
                  <img
                    className="page-image"
                    src={page.url}
                    alt={page.name}
                    loading="eager"
                    decoding="sync"
                    draggable={false}
                    onLoad={() => {
                      if (pendingRestoreRef.current) {
                        setRestoreTick(prev => prev + 1);
                      }
                    }}
                  />
                ) : (
                  <div className="page-skeleton">
                    {page.status === 'error' ? '加载失败' : <Spin size="middle" />}
                  </div>
                )}
              </article>
            ))}
            <div ref={sentinelRef} className="load-more-sentinel" />
          </div>
          <div className="load-state">
            {visibleCount < pages.length ? '继续下滑加载更多页...' : '已加载全部页面'}
          </div>
        </div>
      )}
      <Popover
        trigger="custom"
        visible={flipMenuState.visible}
        onClickOutSide={() => setFlipMenuState(prev => ({ ...prev, visible: false }))}
        position="bottomLeft"
        showArrow={false}
        spacing={4}
        getPopupContainer={() => document.body}
        content={(
          <ContextMenu
            items={viewerMenuItems}
            className="directory-context-menu"
            onItemClick={() => setFlipMenuState(prev => ({ ...prev, visible: false }))}
          />
        )}
      >
        <div
          style={{
            position: 'fixed',
            left: flipMenuState.x,
            top: flipMenuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        />
      </Popover>
      <Modal
        visible={viewerSettingsVisible}
        title="视图设置"
        footer={null}
        onCancel={() => setViewerSettingsVisible(false)}
        centered
        width={760}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
            padding: '20px 20px 12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 12,
              padding: '20px 24px',
              borderRadius: 8,
              border: '1px solid var(--semi-color-border)',
              background: 'var(--semi-color-fill-0)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--semi-color-text-0)' }}>页面间隔</span>
            </div>
            <Slider
              min={0}
              max={MAX_SCROLL_PAGE_GAP_PX}
              step={1}
              value={scrollPageGapPx}
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                if (typeof next !== 'number' || !Number.isFinite(next)) return;
                setScrollPageGapPx(Math.round(Math.min(Math.max(next, 0), MAX_SCROLL_PAGE_GAP_PX)));
              }}
            />
          </div>
          <div
            style={{
              minHeight: 200,
            }}
          />
        </div>
      </Modal>
      {!isFlipMode && (
        <button type="button" className="back-top-btn" onClick={handleBackToTop}>
          回到顶部
        </button>
      )}

      <div className="viewer-footer">
        <div className="footer-side footer-side-left">
          <span className="footer-title-badge">COMIC</span>
          <span className="footer-title" title={displayTitle}>{displayTitle}</span>
        </div>
        <span className="footer-page-meta">{Math.max(currentPageNumber, 1)} / {pages.length} 页</span>
        <div className="footer-side footer-side-right">
          <button
            type="button"
            className={`footer-btn ${isFlipMode ? 'is-active' : ''}`}
            onClick={toggleLayoutMode}
          >
            {layoutModeSwitchLabel}
          </button>
          <button
            type="button"
            className="footer-btn"
            onClick={toggleScrollColumnMode}
          >
            {pageModeSwitchLabel}
          </button>
        </div>
      </div>
    </ComicViewerWrapper>
  );
};

export default ComicViewer;
