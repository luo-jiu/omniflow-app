import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Popover, Spin, Toast } from '@douyinfe/semi-ui';
import {
  batchGetFileLinks,
  deleteNodeAndChildren,
  fetchArchiveCardsPage,
  getFileLink,
  renameNode,
} from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { VideoArchiveViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/context-menu';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';

interface VideoArchiveViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
}

interface VideoArchiveCard {
  id: number;
  title: string;
  sortOrder: number;
  coverNodeId: number | null;
  coverUrl: string | null;
}

interface VideoArchiveSnapshot {
  hasLoadedList: boolean;
  cards: VideoArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
}

const PAGE_SIZE = 24;
const LINK_EXPIRY_MINUTES = 120;
const VIDEO_ARCHIVE_CACHE_MAX_ENTRIES = 24;

const EMPTY_VIDEO_ARCHIVE_SNAPSHOT: VideoArchiveSnapshot = {
  hasLoadedList: false,
  cards: [],
  nextOffset: 0,
  total: 0,
  hasMore: false,
  scrollTop: 0,
};

const videoArchiveSnapshotCache = new Map<string, VideoArchiveSnapshot>();

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

function resolveReaderCacheKey(fileUrl: string, folderNodeId: number | null): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  return `${String(fileUrl || '').trim()}::${folderNodeId}`;
}

function setArchiveSnapshotCache(cacheKey: string, snapshot: VideoArchiveSnapshot) {
  if (videoArchiveSnapshotCache.has(cacheKey)) {
    videoArchiveSnapshotCache.delete(cacheKey);
  }
  videoArchiveSnapshotCache.set(cacheKey, snapshot);
  if (videoArchiveSnapshotCache.size > VIDEO_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = videoArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      videoArchiveSnapshotCache.delete(oldest);
    }
  }
}

const VideoArchiveViewer: React.FC<VideoArchiveViewerProps> = ({
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
}) => {
  const { setFileUrl } = useFileViewer();
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({ baseCardWidth: 336, minScale: 0.84, gridGap: 20 });
  const libraryId = useMemo(() => parseArchiveLibraryId(fileUrl), [fileUrl]);
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const readerCacheKey = useMemo(
    () => resolveReaderCacheKey(fileUrl, folderNodeId),
    [fileUrl, folderNodeId],
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

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const restoreScrollTopRef = useRef<number | null>(null);
  const persistScrollRafRef = useRef<number>(0);

  const persistSnapshot = useCallback((patch: Partial<VideoArchiveSnapshot>) => {
    if (!readerCacheKey) return;
    const prev = videoArchiveSnapshotCache.get(readerCacheKey) ?? EMPTY_VIDEO_ARCHIVE_SNAPSHOT;
    setArchiveSnapshotCache(readerCacheKey, {
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
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => {
          closeContextMenu();
          handleDeleteCard(card);
        },
      },
    ];
  }, [closeContextMenu, handleDeleteCard, libraryId, menuState.card, openRenameDialog]);

  const resolveCardCoverUrls = useCallback(async (
    inputCards: VideoArchiveCard[],
  ): Promise<VideoArchiveCard[]> => {
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

      const rawCards: VideoArchiveCard[] = page.items.map(item => ({
        id: Number(item.id),
        title: String(item.name || ''),
        sortOrder: Number(item.sortOrder ?? 0),
        coverNodeId: Number.isFinite(Number(item.coverNodeId)) && Number(item.coverNodeId) > 0
          ? Number(item.coverNodeId)
          : null,
        coverUrl: null,
      }));
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

  const handleOpenCard = useCallback(async (card: VideoArchiveCard) => {
    if (!libraryId) {
      Toast.error('当前库参数异常');
      return;
    }
    try {
      const nextUrl = await getFileLink(card.id, libraryId, LINK_EXPIRY_MINUTES);
      if (!nextUrl) {
        throw new Error('未获取到视频访问链接');
      }
      setFileUrl(
        nextUrl,
        card.title,
        'video',
        card.id,
        {
          tabTypeLabel: 'VIDEO',
          returnTarget: {
            fileUrl,
            fileName: fileName || title,
            fileType: 'video_archive',
            nodeId: folderNodeId,
            tabTypeLabel: 'VIDEO-ARCHIVE',
          },
        },
      );
    } catch (error: any) {
      runtimeLogger.error('打开视频归档卡片失败:', error);
      Toast.error(error?.message || '打开视频失败');
    }
  }, [fileName, fileUrl, folderNodeId, libraryId, setFileUrl, title]);

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
                    ) : (
                      <div className="card-cover-fallback" aria-hidden>
                        <span className="card-cover-icon">VIDEO</span>
                      </div>
                    )}
                  </div>
                  <div className="card-meta">
                    <div className="card-tag-row">
                      <span className="card-tag-pill">VIDEO</span>
                      <span className="card-open-hint">双击打开</span>
                    </div>
                    <p className="card-title" title={card.title}>{card.title}</p>
                    <div className="card-footer">
                      <span>节点 #{card.id}</span>
                      <span>{card.coverUrl ? '已带封面' : '封面待补'}</span>
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 18px',
          borderTop: '1px solid var(--app-border)',
          background: 'color-mix(in srgb, var(--app-bg-elevated) 92%, white)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span className="badge">VIDEO ARCHIVE</span>
          <h3 className="title" title={title}>{title}</h3>
        </div>
        <div style={{ fontSize: 13, color: 'var(--app-text-secondary)', whiteSpace: 'nowrap' }}>
          共 {total} 项
        </div>
      </div>

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
