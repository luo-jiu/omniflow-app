import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Popover, Spin, Toast } from '@douyinfe/semi-ui';
import {
  batchGetFileLinks,
  fetchArchiveCardsPage,
  fetchNodeDetailById,
  renameNode,
  updateNodeConfig,
} from '@/features/file-explorer/services/file.api';
import { softDeleteNodeSubtree } from '@/features/file-explorer/services/node-deletion';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { ComicArchiveViewerWrapper } from './style';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import type { FileViewerReturnTarget } from '@/contexts/file-viewer.context';
import { buildFileViewerReturnTarget } from '@/contexts/file-viewer-return-target';
import { mapComicArchiveCards } from './comic-archive-card-mapper';
import type { ComicArchiveCard } from './comic-archive-types';
import { useComicArchiveNavigation } from './useComicArchiveNavigation';
import { useFileViewer } from '@/hooks/useFileViewer';
import {
  acknowledgeLatestPendingValue,
  useViewerSession,
  type ViewerSessionAdapter,
} from '@/features/file-viewer/session';
import {
  ARCHIVE_CARD_SESSION_ESTIMATED_BYTES,
  ARCHIVE_CARD_SESSION_SCHEMA_VERSION,
  parseArchiveCardSessionSnapshot,
  resolveArchiveCardRestoreScrollTop,
  type ArchiveCardSessionSnapshot,
} from '@/features/archive-viewer/session/archive-card-session';
import {
  buildViewMetaWithArchiveProgress,
  clamp,
  parseRemoteArchiveProgress,
  parseViewMetaObject,
  type ArchiveReaderProgress,
} from './comic-archive-progress';

interface ComicArchiveViewerProps {
  accountScope: string | null;
  contentRevision: string | null;
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
  libraryId: number | null;
  reloadToken?: number;
  returnTarget?: FileViewerReturnTarget | null;
  tabId: string;
}

const PAGE_SIZE = 24;
const LINK_EXPIRY_MINUTES = 120;
const REMOTE_PROGRESS_SYNC_INTERVAL_MS = 200;
const SCROLL_PROGRESS_PERSIST_DEBOUNCE_MS = 160;

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'COMIC 归档';
  if (raw.startsWith('COMIC 归档 ·')) {
    const stripped = raw.replace(/^COMIC 归档 ·\s*/u, '').trim();
    if (stripped) return stripped;
  }
  return raw;
}

const ComicArchiveViewer: React.FC<ComicArchiveViewerProps> = ({
  accountScope,
  contentRevision,
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
  libraryId,
  reloadToken = 0,
  returnTarget = null,
  tabId,
}) => {
  const { closeTabByNodeId } = useFileViewer();
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({
    baseCardWidth: 275,
    gridGap: 15,
  });
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const currentArchiveReturnTarget = useMemo<FileViewerReturnTarget | null>(() => {
    if (!folderNodeId || !libraryId || !Number.isFinite(folderNodeId)) {
      return null;
    }
    return buildFileViewerReturnTarget({
      fileUrl,
      fileName: fileName || title,
      fileType: 'comic_archive',
      nodeId: folderNodeId,
      tabTypeLabel: 'COMIC-ARC',
      returnTarget: returnTarget ?? null,
    });
  }, [fileName, fileUrl, folderNodeId, libraryId, returnTarget, title]);
  const handleOpenCard = useComicArchiveNavigation({
    libraryId,
    currentArchiveReturnTarget,
  });
  const { showNodeProperties } = useNodePropertiesOverlay({ libraryId });

  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<ComicArchiveCard[]>([]);
  const [, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [restoreTick, setRestoreTick] = useState(0);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    card: ComicArchiveCard | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    card: null,
  });
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameTargetCard, setRenameTargetCard] = useState<ComicArchiveCard | null>(null);
  const [renameInput, setRenameInput] = useState('');

  useEffect(() => {
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
    setRenameDialogVisible(false);
    setRenameTargetCard(null);
  }, [active]);

  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());
  const cardsRef = useRef(cards);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const pendingRestoreRef = useRef<ArchiveReaderProgress | null>(null);
  const pendingSessionResourceNodeIdRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const restoreTriggeredLoadMoreRef = useRef(false);
  const scrollPersistRafRef = useRef<number>(0);
  const scrollPersistTimerRef = useRef<number>(0);
  const remoteSyncTimerRef = useRef<number>(0);
  const remoteSyncInflightRef = useRef(false);
  const pendingRemoteProgressRef = useRef<ArchiveReaderProgress | null>(null);
  const suppressNextScrollPersistRef = useRef(false);
  const viewMetaBaseRef = useRef<Record<string, unknown>>({});
  const viewMetaBaseReadyRef = useRef(false);
  const lastRemoteSyncSignatureRef = useRef('');
  activeRef.current = active;
  cardsRef.current = cards;

  const closeContextMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, visible: false }));
  }, []);

  const openCardContextMenu = useCallback((e: React.MouseEvent, card: ComicArchiveCard) => {
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX;
    const y = e.clientY;
    if (menuState.visible) {
      setMenuState(prev => ({ ...prev, visible: false }));
      setTimeout(() => {
        setMenuState({
          visible: true,
          x,
          y,
          card,
        });
      }, 0);
      return;
    }
    setMenuState({
      visible: true,
      x,
      y,
      card,
    });
  }, [menuState.visible]);

  const openRenameDialog = useCallback((card: ComicArchiveCard) => {
    setRenameTargetCard(card);
    setRenameInput(card.title);
    setRenameDialogVisible(true);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTargetCard) {
      setRenameDialogVisible(false);
      return;
    }
    const nextName = renameInput.trim();
    if (!nextName) {
      Toast.warning('名称不能为空');
      return;
    }
    if (nextName === renameTargetCard.title) {
      setRenameDialogVisible(false);
      setRenameTargetCard(null);
      return;
    }

    setRenameSubmitting(true);
    try {
      await renameNode({
        id: renameTargetCard.id,
        name: nextName,
      });
      setCards(prev => prev.map(card => (
        card.id === renameTargetCard.id
          ? { ...card, title: nextName }
          : card
      )));
      Toast.success('重命名成功');
      setRenameDialogVisible(false);
      setRenameTargetCard(null);
    } catch (error: any) {
      runtimeLogger.error('漫画归档卡片重命名失败:', error);
      Toast.error(error?.message || '重命名失败');
    } finally {
      setRenameSubmitting(false);
    }
  }, [renameInput, renameTargetCard]);

  const handleDeleteCard = useCallback((card: ComicArchiveCard) => {
    if (!libraryId) {
      Toast.error('当前库参数异常');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确认将「${card.title || '未命名目录'}」移入回收站吗？`,
      okButtonProps: { theme: 'solid', type: 'danger' },
      okText: '删除',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          const result = await softDeleteNodeSubtree({
            accountScope,
            ancestorId: card.id,
            libraryId,
          });
          result.deletedNodeIds.forEach(closeTabByNodeId);
          setCards(prev => prev.filter(item => item.id !== card.id));
          setTotal(prev => Math.max(prev - 1, 0));
          if (result.draftCleanupFailed || result.subtreeCollectionFailed) {
            Toast.warning('已移入回收站，但本地文本草稿可能未完整清理');
          } else {
            Toast.success('已移入回收站');
          }
        } catch (error: any) {
          runtimeLogger.error('删除漫画归档卡片失败:', error);
          Toast.error(error?.message || '删除失败');
        }
      },
    });
  }, [accountScope, closeTabByNodeId, libraryId]);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const card = menuState.card;
    if (!card || !libraryId) return [];
    return [
      {
        key: 'rename',
        label: '重命名',
        onClick: () => {
          closeContextMenu();
          openRenameDialog(card);
        },
      },
      {
        key: 'locate-in-tree',
        label: '在目录树中定位',
        onClick: () => {
          closeContextMenu();
          locateNodeInDirectoryTree({
            libraryId,
            nodeId: card.id,
          });
        },
      },
      {
        key: 'props',
        label: '属性',
        onClick: () => {
          closeContextMenu();
          void showNodeProperties({
            id: card.id,
            label: card.title,
          });
        },
      },
      {
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => {
          closeContextMenu();
          handleDeleteCard(card);
        },
      },
    ];
  }, [closeContextMenu, handleDeleteCard, libraryId, menuState.card, openRenameDialog, showNodeProperties]);

  const captureAnchorFromViewport = useCallback((): {
    anchorCardId: number | null;
    anchorOffsetRatio: number;
  } => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { anchorCardId: null, anchorOffsetRatio: 0 };
    }

    const viewportTop = viewport.getBoundingClientRect().top;
    for (const card of cardsRef.current) {
      const el = cardRefs.current.get(card.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= viewportTop + 1) continue;
      const ratio = rect.height > 0 ? clamp((viewportTop - rect.top) / rect.height, 0, 1) : 0;
      return {
        anchorCardId: card.id,
        anchorOffsetRatio: ratio,
      };
    }

    if (cardsRef.current.length > 0) {
      return {
        anchorCardId: cardsRef.current[0].id,
        anchorOffsetRatio: 0,
      };
    }
    return { anchorCardId: null, anchorOffsetRatio: 0 };
  }, [viewportRef]);

  const flushRemoteProgress = useCallback(async (force = false) => {
    if (!folderNodeId || !libraryId) {
      pendingRemoteProgressRef.current = null;
      return;
    }
    if (!active && !force) {
      return;
    }
    if (remoteSyncInflightRef.current) {
      return;
    }

    const pending = pendingRemoteProgressRef.current;
    if (!pending) return;
    const requestId = requestIdRef.current;
    const signature = JSON.stringify(pending);
    if (signature === lastRemoteSyncSignatureRef.current) {
      acknowledgeLatestPendingValue(pendingRemoteProgressRef, pending);
      return;
    }

    let shouldFlushLatest = false;
    remoteSyncInflightRef.current = true;
    try {
      if (!viewMetaBaseReadyRef.current) {
        try {
          const detail = await fetchNodeDetailById(folderNodeId);
          if (requestId !== requestIdRef.current) return;
          viewMetaBaseRef.current = parseViewMetaObject(detail.viewMeta);
          viewMetaBaseReadyRef.current = true;
        } catch (detailError) {
          runtimeLogger.warn('同步前读取漫画归档基础元信息失败:', detailError);
          return;
        }
      }
      const nextMeta = buildViewMetaWithArchiveProgress(viewMetaBaseRef.current, pending);
      const serialized = JSON.stringify(nextMeta);
      await updateNodeConfig({
        id: folderNodeId,
        viewMeta: serialized,
      });
      if (requestId !== requestIdRef.current) return;
      viewMetaBaseRef.current = nextMeta;
      lastRemoteSyncSignatureRef.current = signature;
      shouldFlushLatest = acknowledgeLatestPendingValue(pendingRemoteProgressRef, pending);
    } catch (syncError) {
      runtimeLogger.warn('同步漫画归档阅读位置失败:', syncError);
    } finally {
      if (requestId === requestIdRef.current) {
        remoteSyncInflightRef.current = false;
        if (shouldFlushLatest && pendingRemoteProgressRef.current && (active || force)) {
          if (remoteSyncTimerRef.current) {
            window.clearTimeout(remoteSyncTimerRef.current);
          }
          remoteSyncTimerRef.current = window.setTimeout(() => {
            remoteSyncTimerRef.current = 0;
            void flushRemoteProgress(force);
          }, force ? 0 : REMOTE_PROGRESS_SYNC_INTERVAL_MS);
        }
      }
    }
  }, [active, folderNodeId, libraryId]);

  const queueRemoteProgress = useCallback((progress: ArchiveReaderProgress, force = false) => {
    pendingRemoteProgressRef.current = progress;
    if (!active && !force) {
      return;
    }
    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current);
    }
    remoteSyncTimerRef.current = window.setTimeout(() => {
      remoteSyncTimerRef.current = 0;
      void flushRemoteProgress(force);
    }, force ? 0 : REMOTE_PROGRESS_SYNC_INTERVAL_MS);
  }, [active, flushRemoteProgress]);

  const captureViewportProgress = useCallback((): ArchiveReaderProgress | null => {
    const viewport = viewportRef.current;
    if (!viewport || cardsRef.current.length === 0) return null;
    const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
    const scrollTop = Math.max(viewport.scrollTop, 0);
    const scrollRatio = maxScrollable > 0 ? clamp(scrollTop / maxScrollable, 0, 1) : 0;
    const anchor = captureAnchorFromViewport();
    return {
      anchorCardId: anchor.anchorCardId,
      anchorOffsetRatio: anchor.anchorOffsetRatio,
      scrollTop,
      scrollRatio,
      updatedAt: new Date().toISOString(),
    };
  }, [captureAnchorFromViewport, viewportRef]);

  const captureSessionSnapshot = useCallback((): ArchiveCardSessionSnapshot | null => {
    const pending = pendingRestoreRef.current;
    if (pending) {
      return {
        anchorCardId: pending.anchorCardId,
        anchorOffsetRatio: pending.anchorOffsetRatio,
        scrollRatio: pending.scrollRatio,
        scrollTop: pending.scrollTop,
        selectedCardId: null,
      };
    }
    const progress = captureViewportProgress();
    if (!progress) return null;
    return {
      anchorCardId: progress.anchorCardId,
      anchorOffsetRatio: progress.anchorOffsetRatio,
      scrollRatio: progress.scrollRatio,
      scrollTop: progress.scrollTop,
      selectedCardId: null,
    };
  }, [captureViewportProgress]);

  const restoreSessionSnapshot = useCallback((payload: ArchiveCardSessionSnapshot) => {
    const snapshot = parseArchiveCardSessionSnapshot(payload);
    if (!snapshot) return;
    pendingRestoreRef.current = {
      anchorCardId: snapshot.anchorCardId,
      anchorOffsetRatio: snapshot.anchorOffsetRatio,
      scrollRatio: snapshot.scrollRatio ?? 0,
      scrollTop: snapshot.scrollTop,
      updatedAt: '',
    };
    pendingSessionResourceNodeIdRef.current = folderNodeId;
    setRestoreTick(prev => prev + 1);
  }, [folderNodeId]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<ArchiveCardSessionSnapshot>>(() => ({
    capture: captureSessionSnapshot,
    restore: restoreSessionSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateCost: () => ARCHIVE_CARD_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => (activeRef.current ? ['active'] : []),
  }), [captureSessionSnapshot, restoreSessionSnapshot]);

  const { capture: flushSessionSnapshot } = useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId: folderNodeId,
    reloadToken,
    schemaVersion: ARCHIVE_CARD_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'comic_archive',
  });

  const persistCurrentViewportProgress = useCallback((forceRemoteSync = false) => {
    if (pendingRestoreRef.current) return;
    const progress = captureViewportProgress();
    if (!progress) return;
    flushSessionSnapshot();
    queueRemoteProgress(progress, forceRemoteSync);
  }, [captureViewportProgress, flushSessionSnapshot, queueRemoteProgress]);

  const resolveCardCoverUrls = useCallback(async (
    inputCards: ComicArchiveCard[],
  ): Promise<ComicArchiveCard[]> => {
    if (!libraryId || inputCards.length === 0) {
      return inputCards;
    }

    const unresolvedNodeIds = inputCards
      .filter(card => !card.coverUrl && card.coverNodeId && card.coverNodeId > 0)
      .map(card => card.coverNodeId as number);
    if (unresolvedNodeIds.length === 0) {
      return inputCards;
    }

    try {
      const linkMap = await batchGetFileLinks({
        libraryId,
        nodeIds: unresolvedNodeIds,
        expiry: LINK_EXPIRY_MINUTES,
      });
      if (linkMap.size === 0) {
        return inputCards;
      }
      return inputCards.map((card) => {
        if (!card.coverNodeId || card.coverUrl) return card;
        const nextUrl = linkMap.get(card.coverNodeId);
        if (!nextUrl) return card;
        return {
          ...card,
          coverUrl: nextUrl,
        };
      });
    } catch (coverError) {
      runtimeLogger.warn('批量加载漫画归档封面失败:', coverError);
      return inputCards;
    }
  }, [libraryId]);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (!folderNodeId || !libraryId || !Number.isFinite(folderNodeId)) return;
    const requestId = requestIdRef.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setListLoading(true);
      setError(null);
    }

    try {
      const page = await fetchArchiveCardsPage({
        nodeId: folderNodeId,
        libraryId,
        builtInType: 'COMIC',
        offset,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;

      const rawCards = mapComicArchiveCards(page.items);
      const cardsWithUrl = await resolveCardCoverUrls(rawCards);
      if (requestId !== requestIdRef.current) return;

      setCards((prev) => {
        const merged = append ? [...prev, ...cardsWithUrl] : cardsWithUrl;
        const byId = new Map<number, ComicArchiveCard>();
        merged.forEach((card) => {
          const existing = byId.get(card.id);
          if (!existing) {
            byId.set(card.id, card);
            return;
          }
          byId.set(card.id, {
            ...existing,
            ...card,
            coverUrl: card.coverUrl || existing.coverUrl,
          });
        });
        return Array.from(byId.values()).sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.id - b.id;
        });
      });
      setTotal(page.total);
      setNextOffset(page.offset + page.items.length);
      setHasMore(page.hasMore);
    } catch (loadError) {
      runtimeLogger.error('加载漫画归档分页失败:', loadError);
      if (requestId !== requestIdRef.current) return;
      setError('加载归档失败');
      if (!append) {
        setCards([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setListLoading(false);
        setLoadingMore(false);
      }
    }
  }, [folderNodeId, libraryId, resolveCardCoverUrls]);

  const loadMore = useCallback(() => {
    if (listLoading || loadingMore || !hasMore) return;
    void loadPage(nextOffset, true);
  }, [hasMore, listLoading, loadingMore, loadPage, nextOffset]);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    restoreTriggeredLoadMoreRef.current = false;
    const hasWarmSessionRestore = pendingSessionResourceNodeIdRef.current === folderNodeId;
    if (!hasWarmSessionRestore) {
      pendingRestoreRef.current = null;
      pendingSessionResourceNodeIdRef.current = null;
    }
    cardRefs.current.clear();
    pendingRemoteProgressRef.current = null;
    remoteSyncInflightRef.current = false;
    lastRemoteSyncSignatureRef.current = '';
    viewMetaBaseRef.current = {};
    viewMetaBaseReadyRef.current = false;
    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = 0;
    }

    if (!folderNodeId || !libraryId) {
      setCards([]);
      setError('归档参数异常');
      setListLoading(false);
      setLoadingMore(false);
      setTotal(0);
      setNextOffset(0);
      setHasMore(false);
      return;
    }

    setCards([]);
    setTotal(0);
    setNextOffset(0);
    setHasMore(false);
    setError(null);
    void loadPage(0, false);

    void (async () => {
      try {
        const detail = await fetchNodeDetailById(folderNodeId);
        if (requestId !== requestIdRef.current) return;
        viewMetaBaseRef.current = parseViewMetaObject(detail.viewMeta);
        viewMetaBaseReadyRef.current = true;
        const remoteProgress = parseRemoteArchiveProgress(detail.viewMeta);
        if (!remoteProgress) return;
        if (!hasWarmSessionRestore && !pendingRestoreRef.current) {
          pendingRestoreRef.current = remoteProgress;
          setRestoreTick((prev) => prev + 1);
        }
      } catch (detailError) {
        runtimeLogger.warn('读取漫画归档阅读位置失败:', detailError);
      }
    })();
  }, [folderNodeId, libraryId, loadPage]);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current;
    const pending = pendingRestoreRef.current;
    if (!viewport || !pending) return;

    const finalizeRestore = () => {
      pendingRestoreRef.current = null;
      window.requestAnimationFrame(() => {
        persistCurrentViewportProgress(false);
      });
    };

    if (pending.anchorCardId) {
      const targetCard = cardRefs.current.get(pending.anchorCardId);
      if (!targetCard) {
        if (hasMore && !listLoading && !loadingMore && !restoreTriggeredLoadMoreRef.current) {
          restoreTriggeredLoadMoreRef.current = true;
          void loadPage(nextOffset, true).finally(() => {
            restoreTriggeredLoadMoreRef.current = false;
          });
        }
        if ((listLoading || loadingMore) && cards.length === 0) {
          return;
        }
        if (!hasMore && !listLoading && !loadingMore) {
          const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
          const sessionSnapshot: ArchiveCardSessionSnapshot = {
            anchorCardId: pending.anchorCardId,
            anchorOffsetRatio: pending.anchorOffsetRatio,
            scrollRatio: pending.scrollRatio,
            scrollTop: pending.scrollTop,
            selectedCardId: null,
          };
          suppressNextScrollPersistRef.current = true;
          viewport.scrollTop = resolveArchiveCardRestoreScrollTop({
            anchorHeight: null,
            anchorOffsetTop: null,
            maxScrollable,
            snapshot: sessionSnapshot,
          });
          finalizeRestore();
          return;
        }
        return;
      }

      const cardTop = targetCard.offsetTop;
      const cardHeight = targetCard.offsetHeight || 0;
      const expectedTop = cardTop + cardHeight * clamp(pending.anchorOffsetRatio, 0, 1);
      suppressNextScrollPersistRef.current = true;
      viewport.scrollTop = Math.max(Math.floor(expectedTop), 0);
      finalizeRestore();
      return;
    }

    const maxScrollable = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
    suppressNextScrollPersistRef.current = true;
    viewport.scrollTop = resolveArchiveCardRestoreScrollTop({
      anchorHeight: null,
      anchorOffsetTop: null,
      maxScrollable,
      snapshot: {
        anchorCardId: null,
        anchorOffsetRatio: pending.anchorOffsetRatio,
        scrollRatio: pending.scrollRatio,
        scrollTop: pending.scrollTop,
        selectedCardId: null,
      },
    });
    finalizeRestore();
  }, [
    active,
    cards,
    hasMore,
    listLoading,
    loadPage,
    loadingMore,
    nextOffset,
    persistCurrentViewportProgress,
    restoreTick,
    viewportRef,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const sentinel = sentinelRef.current;
    if (!viewport || !sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting) return;
      loadMore();
    }, {
      root: viewport,
      threshold: 0.05,
      rootMargin: '240px',
    });
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [loadMore, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onScroll = () => {
      if (suppressNextScrollPersistRef.current) {
        suppressNextScrollPersistRef.current = false;
        return;
      }
      if (pendingRestoreRef.current) {
        pendingRestoreRef.current = null;
      }
      if (scrollPersistRafRef.current) {
        window.cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = 0;
      }
      if (scrollPersistTimerRef.current) {
        window.clearTimeout(scrollPersistTimerRef.current);
      }
      scrollPersistTimerRef.current = window.setTimeout(() => {
        scrollPersistTimerRef.current = 0;
        scrollPersistRafRef.current = window.requestAnimationFrame(() => {
          scrollPersistRafRef.current = 0;
          persistCurrentViewportProgress(false);
        });
      }, SCROLL_PROGRESS_PERSIST_DEBOUNCE_MS);
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (scrollPersistTimerRef.current) {
        window.clearTimeout(scrollPersistTimerRef.current);
        scrollPersistTimerRef.current = 0;
      }
      if (scrollPersistRafRef.current) {
        window.cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = 0;
      }
      persistCurrentViewportProgress(true);
    };
  }, [persistCurrentViewportProgress, viewportRef]);

  useEffect(() => {
    if (active || pendingRestoreRef.current) return;
    persistCurrentViewportProgress(true);
  }, [active, persistCurrentViewportProgress]);

  useEffect(() => {
    if (!active) return;
    if (cards.length === 0) return;
    if (pendingRestoreRef.current) return;
    persistCurrentViewportProgress(false);
  }, [active, cards.length, persistCurrentViewportProgress]);

  useEffect(() => () => {
    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = 0;
    }
    void flushRemoteProgress(true);
  }, [flushRemoteProgress]);

  return (
    <>
      <ComicArchiveViewerWrapper style={wrapperStyle}>
        <section className="table-surface" ref={viewportRef}>
          {listLoading ? (
            <div className="state-wrap">
              <Spin size="large" tip="归档加载中..." />
            </div>
          ) : error ? (
            <div className="state-wrap state-error">{error}</div>
          ) : cards.length === 0 ? (
            <div className="state-wrap">当前归档下暂无可展示的漫画集合</div>
          ) : (
            <>
              <div className="cards-grid">
                {cards.map(card => (
                  <article
                    key={card.id}
                    className="archive-card"
                    ref={(el) => {
                      if (el) {
                        cardRefs.current.set(card.id, el);
                      } else {
                        cardRefs.current.delete(card.id);
                      }
                    }}
                    onDoubleClick={() => handleOpenCard(card)}
                    onContextMenu={(e) => openCardContextMenu(e, card)}
                  >
                    {card.coverUrl ? (
                      <img className="card-bg-image" src={card.coverUrl} alt="" draggable={false} aria-hidden />
                    ) : (
                      <div className="card-bg-empty" aria-hidden />
                    )}
                    <div className="card-cover" />
                    <div className="card-meta">
                      <div className="card-tag-slot">
                        <span className={`card-tag-pill ${card.cardKind === 'collection' ? 'collection' : ''}`}>
                          {card.cardKind === 'collection' ? '合集' : 'COMIC'}
                        </span>
                      </div>
                      <div className="card-title" title={card.title}>
                        {card.title}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {loadingMore && (
                <div className="state-wrap">
                  <Spin size="middle" tip="加载更多中..." />
                </div>
              )}
              <div ref={sentinelRef} style={{ height: 1, width: '100%' }} />
            </>
          )}
        </section>

        <footer className="archive-footer">
          <div className="footer-title-group">
            <span className="badge">COMIC ARCHIVE</span>
            <span className="title" title={title}>{title}</span>
          </div>
        </footer>
      </ComicArchiveViewerWrapper>
      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={closeContextMenu}
        position="bottomLeft"
        showArrow={false}
        spacing={4}
        getPopupContainer={() => document.body}
        content={(
          <ContextMenu
            items={contextMenuItems}
            className="directory-context-menu"
            onItemClick={closeContextMenu}
          />
        )}
      >
        <div
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        />
      </Popover>

      <Modal
        title="重命名漫画集合"
        visible={renameDialogVisible}
        confirmLoading={renameSubmitting}
        okText="保存"
        cancelText="取消"
        centered
        width={420}
        onOk={handleRenameSubmit}
        onCancel={() => {
          if (renameSubmitting) return;
          setRenameDialogVisible(false);
          setRenameTargetCard(null);
          setRenameInput('');
        }}
      >
        <Input
          placeholder="请输入新名称"
          value={renameInput}
          onChange={setRenameInput}
          autoFocus
          onEnterPress={handleRenameSubmit}
          maxLength={255}
        />
      </Modal>
    </>
  );
};

export default ComicArchiveViewer;
