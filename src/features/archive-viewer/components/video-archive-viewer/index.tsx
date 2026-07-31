import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Popover, Spin, Toast } from '@douyinfe/semi-ui';
import {
  batchGetFileLinks,
  deleteNodeAndChildren,
  fetchArchiveCardsPage,
  getChildrenByNodeId,
  getFileLink,
  renameNode,
  type ArchiveCardDTO,
  type ArchiveCardsPageResult,
} from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { VideoArchiveViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import type {
  FileViewerSubtitleSource,
  FileViewerVideoPlaylist,
  FileViewerVideoPlaylistItem,
} from '@/contexts/file-viewer.context';
import {
  buildVideoSubtitleSources,
  normalizeVideoArchiveMatchName,
  VIDEO_ARCHIVE_EMPTY_SIDECARS,
  type VideoArchiveChildNode,
  type VideoArchiveSidecarIndex,
} from './video-archive-sidecars';
import {
  EMPTY_VIDEO_ARCHIVE_SNAPSHOT,
  resolveVideoArchiveReaderCacheKey,
  setVideoArchiveSnapshotCache,
  videoArchiveSnapshotCache,
  type VideoArchiveCard,
  type VideoArchiveSnapshot,
} from './video-archive-cache';

interface VideoArchiveViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
  reloadToken?: number;
}

const PAGE_SIZE = 24;
const COLLECTION_PLAYLIST_PAGE_SIZE = 80;
const LINK_EXPIRY_MINUTES = 120;
const VIDEO_PREVIEW_SAMPLE_TIME = 0.5;

function parseArchiveLibraryId(fileUrl: string): number | null {
  const matches = /^video-archive:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'VIDEO 归档';
  if (raw.startsWith('VIDEO 归档 ·')) {
    const stripped = raw.replace(/^VIDEO 归档 ·\s*/u, '').trim();
    if (stripped) return stripped;
  }
  return raw;
}

function normalizeVideoArchiveCardKind(input?: string | null): VideoArchiveCard['cardKind'] {
  return String(input || '').trim().toLowerCase() === 'collection' ? 'collection' : 'media';
}

function mapVideoArchiveCards(
  items: ArchiveCardDTO[],
  sidecarIndex: VideoArchiveSidecarIndex,
): VideoArchiveCard[] {
  return items.map((item) => {
    const cardId = Number(item.id);
    const cardKind = normalizeVideoArchiveCardKind(item.cardKind);
    const mediaNodeId = Number.isFinite(Number(item.mediaNodeId)) && Number(item.mediaNodeId) > 0
      ? Number(item.mediaNodeId)
      : cardKind === 'collection' ? 0 : cardId;
    const matchName = normalizeVideoArchiveMatchName(item.name);
    const explicitCoverNodeId = Number.isFinite(Number(item.coverNodeId)) && Number(item.coverNodeId) > 0
      ? Number(item.coverNodeId)
      : null;
    const sidecarCoverNodeId = matchName ? sidecarIndex.coverNodeIdByName.get(matchName) ?? null : null;
    const subtitleCount = Math.max(
      Number(item.subtitleCount ?? 0),
      matchName ? sidecarIndex.subtitlesByName.get(matchName)?.length ?? 0 : 0,
    );
    return {
      id: cardId,
      mediaNodeId,
      title: String(item.name || ''),
      sortOrder: Number(item.sortOrder ?? 0),
      cardKind,
      coverNodeId: explicitCoverNodeId || sidecarCoverNodeId,
      coverUrl: null,
      videoPreviewUrl: null,
      subtitleCount,
      durationSeconds: Number(item.durationSeconds ?? 0) > 0 ? Number(item.durationSeconds) : undefined,
    };
  });
}

async function fetchCollectionArchiveCardsPage(
  collectionNodeId: number,
  libraryId: number,
  offset = 0,
): Promise<ArchiveCardsPageResult> {
  return fetchArchiveCardsPage({
    nodeId: collectionNodeId,
    libraryId,
    builtInType: 'VIDEO',
    offset,
    limit: COLLECTION_PLAYLIST_PAGE_SIZE,
  });
}

function resolveArchivePageNextOffset(page: ArchiveCardsPageResult, fallbackOffset: number): number {
  const pageOffset = Number.isFinite(Number(page.offset)) ? Number(page.offset) : fallbackOffset;
  return pageOffset + page.items.length;
}

function buildSameLevelSubtitleSources(
  card: VideoArchiveCard,
  sidecarIndex: VideoArchiveSidecarIndex,
  libraryId: number,
): FileViewerSubtitleSource[] | undefined {
  if ((card.subtitleCount || 0) <= 0) return undefined;
  const matchName = normalizeVideoArchiveMatchName(card.title);
  const sidecars = matchName ? sidecarIndex.subtitlesByName.get(matchName) ?? [] : [];
  const sources = buildVideoSubtitleSources(sidecars, libraryId);
  return sources.length > 0 ? sources : undefined;
}

function buildCollectionPlaylistItem(
  card: VideoArchiveCard,
  sidecarIndex: VideoArchiveSidecarIndex,
  libraryId: number,
): FileViewerVideoPlaylistItem {
  const subtitleCardNodeId = (card.subtitleCount || 0) > 0 && card.mediaNodeId && card.mediaNodeId !== card.id
    ? card.id
    : null;
  return {
    nodeId: card.mediaNodeId || card.id,
    libraryId,
    title: card.title,
    sortOrder: card.sortOrder,
    durationSeconds: card.durationSeconds ?? null,
    subtitleCardNodeId,
    subtitleSources: subtitleCardNodeId ? undefined : buildSameLevelSubtitleSources(card, sidecarIndex, libraryId),
  };
}

function seekVideoPreviewFrame(video: HTMLVideoElement) {
  if (
    !Number.isFinite(video.duration)
    || video.duration <= VIDEO_PREVIEW_SAMPLE_TIME + 0.1
    || video.currentTime >= 0.05
  ) {
    return;
  }
  try {
    video.currentTime = VIDEO_PREVIEW_SAMPLE_TIME;
  } catch {
    // Preview-only video elements can keep their fallback frame if seeking is unsupported.
  }
}

function formatVideoDuration(durationSeconds?: number): string {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.max(Math.floor(duration), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

const VideoArchiveViewer: React.FC<VideoArchiveViewerProps> = ({
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
  reloadToken = 0,
}) => {
  const { setFileUrl } = useFileViewer();
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({
    baseCardWidth: 275,
    gridGap: 15,
  });
  const libraryId = useMemo(() => parseArchiveLibraryId(fileUrl), [fileUrl]);
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const { showNodeProperties } = useNodePropertiesOverlay({ libraryId });
  const readerCacheKey = useMemo(
    () => resolveVideoArchiveReaderCacheKey(fileUrl, folderNodeId, reloadToken),
    [fileUrl, folderNodeId, reloadToken],
  );

  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [cards, setCards] = useState<VideoArchiveCard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    card: VideoArchiveCard | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    card: null,
  });
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameTargetCard, setRenameTargetCard] = useState<VideoArchiveCard | null>(null);
  const [renameInput, setRenameInput] = useState('');

  useEffect(() => {
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
    setRenameDialogVisible(false);
    setRenameTargetCard(null);
  }, [active]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const restoreScrollTopRef = useRef<number | null>(null);
  const persistScrollRafRef = useRef<number>(0);

  const persistSnapshot = useCallback((patch: Partial<VideoArchiveSnapshot>) => {
    if (!readerCacheKey) return;
    const prev = videoArchiveSnapshotCache.get(readerCacheKey) ?? EMPTY_VIDEO_ARCHIVE_SNAPSHOT;
    setVideoArchiveSnapshotCache(readerCacheKey, {
      hasLoadedList: patch.hasLoadedList ?? prev.hasLoadedList,
      cards: patch.cards ?? prev.cards,
      nextOffset: patch.nextOffset ?? prev.nextOffset,
      total: patch.total ?? prev.total,
      hasMore: patch.hasMore ?? prev.hasMore,
      scrollTop: patch.scrollTop ?? prev.scrollTop,
    });
  }, [readerCacheKey]);

  const closeContextMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, visible: false }));
  }, []);

  const openCardContextMenu = useCallback((e: React.MouseEvent, card: VideoArchiveCard) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      card,
    });
  }, []);

  const openRenameDialog = useCallback((card: VideoArchiveCard) => {
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
      runtimeLogger.error('视频归档卡片重命名失败:', error);
      Toast.error(error?.message || '重命名失败');
    } finally {
      setRenameSubmitting(false);
    }
  }, [renameInput, renameTargetCard]);

  const handleDeleteCard = useCallback((card: VideoArchiveCard) => {
    if (!libraryId) {
      Toast.error('当前库参数异常');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确认将「${card.title || '未命名视频'}」移入回收站吗？`,
      okButtonProps: { theme: 'solid', type: 'danger' },
      okText: '删除',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          await deleteNodeAndChildren(card.id, libraryId);
          const nextCards = cards.filter(item => item.id !== card.id);
          const nextTotal = Math.max(total - 1, 0);
          setCards(nextCards);
          setTotal(nextTotal);
          setNextOffset(nextCards.length);
          setHasMore(nextCards.length < nextTotal);
          Toast.success('已移入回收站');
        } catch (error: any) {
          runtimeLogger.error('删除视频归档卡片失败:', error);
          Toast.error(error?.message || '删除失败');
        }
      },
    });
  }, [cards, libraryId, total]);

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

  const resolveCardCoverUrls = useCallback(async (
    inputCards: VideoArchiveCard[],
  ): Promise<VideoArchiveCard[]> => {
    if (!libraryId || inputCards.length === 0) {
      return inputCards;
    }

    const unresolvedNodeIds = Array.from(new Set(inputCards
      .filter(card => !card.coverUrl)
      .map((card) => {
        if (card.coverNodeId && card.coverNodeId > 0) return card.coverNodeId;
        if (card.cardKind === 'collection') return 0;
        return card.mediaNodeId || card.id;
      })
      .filter((nodeId): nodeId is number => Number.isFinite(nodeId) && nodeId > 0)));
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
        if (card.coverUrl) return card;
        const targetNodeId = card.coverNodeId && card.coverNodeId > 0
          ? card.coverNodeId
          : card.mediaNodeId || card.id;
        const nextUrl = linkMap.get(targetNodeId);
        if (!nextUrl) return card;
        return {
          ...card,
          coverUrl: card.coverNodeId ? nextUrl : null,
          videoPreviewUrl: card.coverNodeId ? card.videoPreviewUrl : nextUrl,
        };
      });
    } catch (coverError) {
      runtimeLogger.warn('批量加载视频归档封面失败:', coverError);
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
        builtInType: 'VIDEO',
        offset,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;

      const rawCards = mapVideoArchiveCards(page.items, VIDEO_ARCHIVE_EMPTY_SIDECARS);
      const cardsWithCover = await resolveCardCoverUrls(rawCards);
      if (requestId !== requestIdRef.current) return;

      setCards((prev) => {
        const merged = append ? [...prev, ...cardsWithCover] : cardsWithCover;
        const byId = new Map<number, VideoArchiveCard>();
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
            videoPreviewUrl: card.videoPreviewUrl || existing.videoPreviewUrl,
            subtitleCount: Math.max(card.subtitleCount || 0, existing.subtitleCount || 0),
            durationSeconds: card.durationSeconds || existing.durationSeconds,
            cardKind: card.cardKind || existing.cardKind,
          });
        });
        return Array.from(byId.values()).sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.id - b.id;
        });
      });
      setHasLoadedList(true);
      setTotal(page.total);
      setNextOffset(page.offset + page.items.length);
      setHasMore(page.hasMore);
    } catch (loadError) {
      runtimeLogger.error('加载视频归档分页失败:', loadError);
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

  const loadCardSubtitleSourcesWithIndex = useCallback(async (
    card: VideoArchiveCard,
    sidecarIndex: VideoArchiveSidecarIndex,
  ): Promise<FileViewerSubtitleSource[]> => {
    if (!libraryId) return [];
    if (card.cardKind === 'collection') return [];
    if ((card.subtitleCount || 0) <= 0) return [];

    if (card.mediaNodeId && card.mediaNodeId !== card.id) {
      try {
        const children = (await getChildrenByNodeId(card.id, libraryId)) as VideoArchiveChildNode[];
        return buildVideoSubtitleSources(children, libraryId);
      } catch (error) {
        runtimeLogger.warn('加载视频单元字幕失败:', error);
        return [];
      }
    }

    try {
      const matchName = normalizeVideoArchiveMatchName(card.title);
      const sidecars = matchName ? sidecarIndex.subtitlesByName.get(matchName) ?? [] : [];
      return buildVideoSubtitleSources(sidecars, libraryId);
    } catch (error) {
      runtimeLogger.warn('加载历史视频同名字幕失败:', error);
      return [];
    }
  }, [libraryId]);

  const loadCardSubtitleSources = useCallback(async (
    card: VideoArchiveCard,
  ): Promise<FileViewerSubtitleSource[]> => {
    return loadCardSubtitleSourcesWithIndex(card, VIDEO_ARCHIVE_EMPTY_SIDECARS);
  }, [loadCardSubtitleSourcesWithIndex]);

  const loadPlaylistItemSubtitleSources = useCallback(async (
    item: FileViewerVideoPlaylistItem,
  ): Promise<FileViewerSubtitleSource[]> => {
    if (item.subtitleSources) return item.subtitleSources;
    if (!item.subtitleCardNodeId) return [];

    try {
      const children = (await getChildrenByNodeId(item.subtitleCardNodeId, item.libraryId)) as VideoArchiveChildNode[];
      return buildVideoSubtitleSources(children, item.libraryId);
    } catch (error) {
      runtimeLogger.warn('加载合集首播字幕失败:', error);
      return [];
    }
  }, []);

  const buildCollectionPlaylist = useCallback(async (
    collectionCard: VideoArchiveCard,
  ): Promise<{
    playlist: FileViewerVideoPlaylist;
    firstItem: FileViewerVideoPlaylistItem;
  } | null> => {
    if (!libraryId) return null;

    const page = await fetchCollectionArchiveCardsPage(collectionCard.id, libraryId);
    const mediaCards = mapVideoArchiveCards(page.items, VIDEO_ARCHIVE_EMPTY_SIDECARS)
      .filter(card => card.cardKind === 'media' && (card.mediaNodeId || card.id))
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.id - right.id;
      });

    if (mediaCards.length === 0) {
      return null;
    }

    const items = mediaCards.map(card => buildCollectionPlaylistItem(card, VIDEO_ARCHIVE_EMPTY_SIDECARS, libraryId));
    const firstItem = items[0];
    if (!firstItem) return null;
    const firstSubtitleSources = await loadPlaylistItemSubtitleSources(firstItem);
    const playlistItems = firstSubtitleSources.length > 0
      ? items.map(item => (
        item.nodeId === firstItem.nodeId && item.libraryId === firstItem.libraryId
          ? { ...item, subtitleSources: firstSubtitleSources }
          : item
      ))
      : items;
    const firstItemWithSubtitles = playlistItems[0] ?? firstItem;

    return {
      playlist: {
        id: `video-collection:${libraryId}:${collectionCard.id}`,
        title: collectionCard.title || '视频合集',
        items: playlistItems,
        total: page.total,
        nextOffset: resolveArchivePageNextOffset(page, 0),
        hasMore: page.hasMore,
        source: {
          kind: 'video_archive_collection',
          nodeId: collectionCard.id,
          libraryId,
        },
      },
      firstItem: firstItemWithSubtitles,
    };
  }, [libraryId, loadPlaylistItemSubtitleSources]);

  const handleOpenCard = useCallback(async (card: VideoArchiveCard) => {
    if (!libraryId) {
      Toast.error('当前库参数异常');
      return;
    }
    if (card.cardKind === 'collection') {
      try {
        const collection = await buildCollectionPlaylist(card);
        if (!collection) {
          Toast.warning('该合集下暂无可播放视频');
          return;
        }
        const nextUrl = await getFileLink(
          collection.firstItem.nodeId,
          collection.firstItem.libraryId,
          LINK_EXPIRY_MINUTES,
        );
        if (!nextUrl) {
          throw new Error('未获取到视频访问链接');
        }
        setFileUrl(
          nextUrl,
          collection.firstItem.title,
          'video',
          collection.firstItem.nodeId,
          {
            tabTypeLabel: 'VIDEO',
            returnTarget: {
              fileUrl,
              fileName: fileName || title,
              fileType: 'video_archive',
              nodeId: folderNodeId,
              tabTypeLabel: 'VIDEO-ARCHIVE',
            },
            videoSubtitleSources: collection.firstItem.subtitleSources,
            videoPlaylist: collection.playlist,
            videoAutoPlay: true,
          },
        );
      } catch (error: any) {
        runtimeLogger.error('打开视频合集失败:', error);
        Toast.error(error?.message || '打开合集失败');
      }
      return;
    }
    try {
      const nextUrl = await getFileLink(card.mediaNodeId || card.id, libraryId, LINK_EXPIRY_MINUTES);
      if (!nextUrl) {
        throw new Error('未获取到视频访问链接');
      }
      const videoSubtitleSources = await loadCardSubtitleSources(card);
      setFileUrl(
        nextUrl,
        card.title,
        'video',
        card.mediaNodeId || card.id,
        {
          tabTypeLabel: 'VIDEO',
          returnTarget: {
            fileUrl,
            fileName: fileName || title,
            fileType: 'video_archive',
            nodeId: folderNodeId,
            tabTypeLabel: 'VIDEO-ARCHIVE',
          },
          videoSubtitleSources,
        },
      );
    } catch (error: any) {
      runtimeLogger.error('打开视频归档卡片失败:', error);
      Toast.error(error?.message || '打开视频失败');
    }
  }, [
    fileName,
    fileUrl,
    folderNodeId,
    buildCollectionPlaylist,
    libraryId,
    loadCardSubtitleSources,
    setFileUrl,
    title,
  ]);

  useEffect(() => {
    requestIdRef.current += 1;
    if (persistScrollRafRef.current) {
      window.cancelAnimationFrame(persistScrollRafRef.current);
      persistScrollRafRef.current = 0;
    }

    if (!folderNodeId || !libraryId) {
      setHasLoadedList(false);
      setCards([]);
      setError('归档参数异常');
      setListLoading(false);
      setLoadingMore(false);
      setTotal(0);
      setNextOffset(0);
      setHasMore(false);
      return;
    }

    const cached = readerCacheKey ? videoArchiveSnapshotCache.get(readerCacheKey) : null;
    if (cached?.hasLoadedList) {
      setHasLoadedList(true);
      setCards(cached.cards);
      setTotal(cached.total);
      setNextOffset(cached.nextOffset);
      setHasMore(cached.hasMore);
      setError(null);
      setListLoading(false);
      setLoadingMore(false);
      restoreScrollTopRef.current = cached.scrollTop;
      return;
    }

    setHasLoadedList(false);
    setCards([]);
    setTotal(0);
    setNextOffset(0);
    setHasMore(false);
    setError(null);
    restoreScrollTopRef.current = 0;
    void loadPage(0, false);
  }, [folderNodeId, libraryId, loadPage, readerCacheKey]);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextScrollTop = restoreScrollTopRef.current;
    if (nextScrollTop === null) return;

    const restore = window.requestAnimationFrame(() => {
      viewport.scrollTop = Math.max(Math.floor(nextScrollTop), 0);
      restoreScrollTopRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(restore);
    };
  }, [active, cards.length, viewportRef]);

  useEffect(() => {
    persistSnapshot({
      hasLoadedList,
      cards,
      nextOffset,
      total,
      hasMore,
    });
  }, [cards, hasLoadedList, hasMore, nextOffset, persistSnapshot, total]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onScroll = () => {
      if (persistScrollRafRef.current) {
        window.cancelAnimationFrame(persistScrollRafRef.current);
      }
      persistScrollRafRef.current = window.requestAnimationFrame(() => {
        persistScrollRafRef.current = 0;
        persistSnapshot({
          hasLoadedList,
          cards,
          nextOffset,
          total,
          hasMore,
          scrollTop: Math.max(viewport.scrollTop, 0),
        });
      });
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (persistScrollRafRef.current) {
        window.cancelAnimationFrame(persistScrollRafRef.current);
        persistScrollRafRef.current = 0;
      }
    };
  }, [cards, hasLoadedList, hasMore, nextOffset, persistSnapshot, total, viewportRef]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible) {
        loadMore();
      }
    }, {
      root: viewport,
      rootMargin: '0px 0px 360px 0px',
      threshold: 0,
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, viewportRef]);

  return (
    <VideoArchiveViewerWrapper style={wrapperStyle}>
      <div className="table-surface" ref={viewportRef as React.RefObject<HTMLDivElement>}>
        {listLoading ? (
          <div className="state-wrap">
            <Spin size="large" tip="归档加载中..." />
          </div>
        ) : error ? (
          <div className="state-wrap state-error">{error}</div>
        ) : cards.length === 0 ? (
          <div className="state-wrap">当前归档下暂无可展示的视频资源</div>
        ) : (
          <>
            <div className="cards-grid">
              {cards.map(card => (
                <article
                  key={card.id}
                  className="archive-card"
                  onContextMenu={(e) => openCardContextMenu(e, card)}
                  onDoubleClick={() => {
                    void handleOpenCard(card);
                  }}
                >
                  <div className="card-cover">
                    {card.coverUrl ? (
                      <img src={card.coverUrl} alt={card.title} draggable={false} />
                    ) : card.cardKind === 'collection' ? (
                      <div className="card-cover-fallback collection" aria-hidden>
                        <span className="card-cover-icon">合集</span>
                      </div>
                    ) : card.videoPreviewUrl ? (
                      <video
                        src={card.videoPreviewUrl}
                        preload="metadata"
                        muted
                        playsInline
                        aria-label={card.title}
                        onLoadedMetadata={(event) => seekVideoPreviewFrame(event.currentTarget)}
                      />
                    ) : (
                      <div className="card-cover-fallback" aria-hidden>
                        <span className="card-cover-icon">VIDEO</span>
                      </div>
                    )}
                  </div>
                  <div className="card-meta">
                    <div className="card-tag-row">
                      <span className={`card-tag-pill ${card.cardKind === 'collection' ? 'collection' : ''}`}>
                        {card.cardKind === 'collection' ? '合集' : 'VIDEO'}
                      </span>
                    </div>
                    <p className="card-title" title={card.title}>{card.title}</p>
                    <div className="card-footer">
                      <span>
                        {card.cardKind === 'collection'
                          ? '双击播放合集'
                          : (
                            <>
                              {card.coverUrl ? '已带封面' : (card.videoPreviewUrl ? '视频首帧' : '封面待补')}
                              {card.subtitleCount > 0 ? ` · 字幕 ${card.subtitleCount}` : ''}
                            </>
                          )}
                      </span>
                      {card.cardKind === 'collection' ? (
                        <span className="card-duration collection" title="合集">合集</span>
                      ) : (
                        <span className="card-duration" title="视频时长">
                          {formatVideoDuration(card.durationSeconds)}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {loadingMore && (
              <div className="state-wrap">
                <Spin size="large" tip="正在加载更多..." />
              </div>
            )}
            <div ref={sentinelRef} style={{ height: 1, width: '100%' }} />
          </>
        )}
      </div>

      <footer className="archive-footer">
        <div className="footer-title-group">
          <span className="badge">VIDEO ARCHIVE</span>
          <span className="title" title={title}>{title}</span>
        </div>
        <div className="archive-count">
          共 {total} 项
        </div>
      </footer>

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
        title="重命名视频"
        visible={renameDialogVisible}
        onCancel={() => {
          if (renameSubmitting) return;
          setRenameDialogVisible(false);
          setRenameTargetCard(null);
        }}
        onOk={() => {
          void handleRenameSubmit();
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameSubmitting}
        centered
        width={420}
      >
        <Input
          value={renameInput}
          onChange={(value) => setRenameInput(String(value ?? ''))}
          placeholder="请输入视频名称"
          maxLength={120}
          disabled={renameSubmitting}
          autoFocus
        />
      </Modal>
    </VideoArchiveViewerWrapper>
  );
};

export default VideoArchiveViewer;
