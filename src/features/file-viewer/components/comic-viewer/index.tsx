import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import {
  fetchNodeDetailById,
  getChildrenByNodeId,
  getFileLink,
  updateNodeConfig,
} from '@/features/file-explorer/services/file.api';
import { ComicViewerWrapper } from './style';
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

interface ComicReaderSnapshot {
  hasLoadedList: boolean;
  pages: ComicPageItem[];
  visibleCount: number;
  scrollTop: number;
  scrollRatio: number;
  anchorPageId: number | null;
  anchorOffsetRatio: number;
}

const INITIAL_VISIBLE_COUNT = 8;
const LOAD_MORE_STEP = 6;
const PREFETCH_AHEAD = 6;
const MAX_RESOLVE_PER_TICK = 8;
const MIN_PAGE_WIDTH = 360;
const MAX_PAGE_WIDTH = 980;
const COMIC_READER_CACHE_MAX_ENTRIES = 24;
const REMOTE_PROGRESS_SYNC_INTERVAL_MS = 3200;
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

interface ComicRemoteReadingProgress {
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  currentPageNumber: number;
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
  if (!currentPageNumber && !anchorPageId) {
    return null;
  }
  return {
    anchorPageId,
    anchorOffsetRatio: parseRatio(comicReaderState.anchorOffsetRatio),
    currentPageNumber: currentPageNumber ?? 1,
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
      currentPageNumber: progress.currentPageNumber,
      updatedAt: progress.updatedAt,
    },
  };
  return nextMeta;
}

function resolveRemoteRestoreTarget(
  pages: ComicPageItem[],
  remoteProgress: ComicRemoteReadingProgress,
): { anchorPageId: number | null; anchorOffsetRatio: number; pageNumber: number } | null {
  if (pages.length === 0) {
    return null;
  }

  const targetByAnchor = remoteProgress.anchorPageId
    ? pages.findIndex(page => page.id === remoteProgress.anchorPageId)
    : -1;
  const targetByPage = clamp(Math.floor(remoteProgress.currentPageNumber || 1), 1, pages.length) - 1;
  const targetIndex = targetByAnchor >= 0 ? targetByAnchor : targetByPage;
  const targetPage = pages[targetIndex];
  if (!targetPage) {
    return null;
  }
  return {
    anchorPageId: targetPage.id,
    anchorOffsetRatio: clamp(remoteProgress.anchorOffsetRatio, 0, 1),
    pageNumber: targetIndex + 1,
  };
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
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
  const viewMetaBaseRef = useRef<Record<string, unknown>>({});
  const remoteProgressSyncTimerRef = useRef<number>(0);
  const remoteProgressSyncInFlightRef = useRef(false);
  const pendingRemoteProgressRef = useRef<ComicRemoteReadingProgress | null>(null);
  const lastSyncedRemoteProgressSignatureRef = useRef<string>('');

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
            desiredScrollTop: 0,
            desiredScrollRatio: 0,
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
            desiredScrollTop: 0,
            desiredScrollRatio: 0,
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
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (!readerCacheKey) return;
    if (!hasLoadedListRef.current) return;
    if (isHydratingSnapshotRef.current) return;
    const scrollTop = Math.max(scrollEl.scrollTop, 0);
    const maxScrollable = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0);
    const scrollRatio = maxScrollable > 0
      ? clamp(scrollTop / maxScrollable, 0, 1)
      : 0;
    const anchorSnapshot = captureAnchorSnapshot(scrollEl);
    setCurrentPageNumber(anchorSnapshot.currentPageNumber);
    persistReaderSnapshot({
      hasLoadedList: true,
      scrollTop,
      scrollRatio,
      anchorPageId: anchorSnapshot.anchorPageId,
      anchorOffsetRatio: anchorSnapshot.anchorOffsetRatio,
    });
    if (active) {
      queueRemoteReadingProgressSync({
        anchorPageId: anchorSnapshot.anchorPageId,
        anchorOffsetRatio: anchorSnapshot.anchorOffsetRatio,
        currentPageNumber: anchorSnapshot.currentPageNumber,
        updatedAt: new Date().toISOString(),
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
    flushRemoteReadingProgress,
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
    if (scrollPersistRafRef.current) return;
    scrollPersistRafRef.current = window.requestAnimationFrame(() => {
      scrollPersistRafRef.current = 0;
      persistCurrentScroll();
    });
  }, [persistCurrentScroll]);

  const handleBackToTop = useCallback(() => {
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
  }, [pages.length, persistCurrentScroll]);

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
      },
    );

    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [pages.length, visibleCount]);

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
      const results = await Promise.all(targets.map(async ({ index, page }) => {
        try {
          const url = await getFileLink(page.id, libraryId, 60);
          return { index, success: true as const, url };
        } catch (error) {
          runtimeLogger.error('加载漫画页链接失败:', error);
          return { index, success: false as const, url: null };
        }
      }));

      if (sessionRef.current !== currentSession) {
        return;
      }

      setPages((prev) => prev.map((page, index) => {
        const matched = results.find((result) => result.index === index);
        if (!matched) return page;
        if (matched.success && matched.url) {
          return { ...page, status: 'ready', url: matched.url };
        }
        return { ...page, status: 'error', url: null };
      }));
    };

    void resolveLinks();
  }, [folderNodeId, libraryId, pages, visibleCount]);

  const pageWidth = useMemo(() => {
    if (!scrollWidth) return 760;
    return clamp(scrollWidth - 32, MIN_PAGE_WIDTH, MAX_PAGE_WIDTH);
  }, [scrollWidth]);

  useEffect(() => {
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
  }, [captureAnchorSnapshot, persistReaderSnapshot, renderedPages.length, restoreTick]);

  useEffect(() => {
    if (!active) return;
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      setScrollWidth(Math.round(scrollEl.clientWidth));
    }
    if (!readerCacheKey || pages.length === 0) {
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
  }, [active, pages.length, readerCacheKey]);

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

  return (
    <ComicViewerWrapper>
      <div className="pages-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="pages-column" style={{ width: `${pageWidth}px` }}>
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
          <div className="load-state">
            {visibleCount < pages.length ? '继续下滑加载更多页...' : '已加载全部页面'}
          </div>
        </div>
      </div>
      <button type="button" className="back-top-btn" onClick={handleBackToTop}>
        回到顶部
      </button>

      <div className="viewer-footer">
        <div className="footer-title-group">
          <span className="footer-title-badge">COMIC</span>
          <span className="footer-title" title={displayTitle}>{displayTitle}</span>
        </div>
        <span className="footer-page-meta">{Math.max(currentPageNumber, 1)} / {pages.length} 页</span>
      </div>
    </ComicViewerWrapper>
  );
};

export default ComicViewer;
