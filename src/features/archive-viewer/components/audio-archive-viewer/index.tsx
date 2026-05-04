import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spin, Toast } from '@douyinfe/semi-ui';
import {
  fetchArchiveCardsPage,
  getFileLink,
} from '@/features/file-explorer/services/file.api';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { useFileViewer } from '@/hooks/useFileViewer';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';
import { AudioArchiveViewerWrapper } from './style';

interface AudioArchiveViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
}

interface AudioArchiveCard {
  id: number;
  title: string;
  sortOrder: number;
}

interface AudioArchiveSnapshot {
  hasLoadedList: boolean;
  cards: AudioArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
}

const PAGE_SIZE = 36;
const LINK_EXPIRY_MINUTES = 120;
const AUDIO_ARCHIVE_CACHE_MAX_ENTRIES = 24;

const EMPTY_AUDIO_ARCHIVE_SNAPSHOT: AudioArchiveSnapshot = {
  hasLoadedList: false,
  cards: [],
  nextOffset: 0,
  total: 0,
  hasMore: false,
  scrollTop: 0,
};

const audioArchiveSnapshotCache = new Map<string, AudioArchiveSnapshot>();

function parseArchiveLibraryId(fileUrl: string): number | null {
  const matches = /^audio-archive:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'AUDIO 归档';
  if (raw.startsWith('AUDIO 归档 ·')) {
    const stripped = raw.replace(/^AUDIO 归档 ·\s*/u, '').trim();
    if (stripped) return stripped;
  }
  return raw;
}

function resolveReaderCacheKey(fileUrl: string, folderNodeId: number | null): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  return `${String(fileUrl || '').trim()}::${folderNodeId}`;
}

function setArchiveSnapshotCache(cacheKey: string, snapshot: AudioArchiveSnapshot) {
  if (audioArchiveSnapshotCache.has(cacheKey)) {
    audioArchiveSnapshotCache.delete(cacheKey);
  }
  audioArchiveSnapshotCache.set(cacheKey, snapshot);
  if (audioArchiveSnapshotCache.size > AUDIO_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = audioArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      audioArchiveSnapshotCache.delete(oldest);
    }
  }
}

const AudioArchiveViewer: React.FC<AudioArchiveViewerProps> = ({
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
}) => {
  const { setFileUrl } = useFileViewer();
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({
    baseCardWidth: 198,
    minScale: 0.82,
    gridGap: 13,
  });
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
  const [cards, setCards] = useState<AudioArchiveCard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const restoreScrollTopRef = useRef<number | null>(null);
  const persistScrollRafRef = useRef<number>(0);

  const persistSnapshot = useCallback((patch: Partial<AudioArchiveSnapshot>) => {
    if (!readerCacheKey) return;
    const prev = audioArchiveSnapshotCache.get(readerCacheKey) ?? EMPTY_AUDIO_ARCHIVE_SNAPSHOT;
    setArchiveSnapshotCache(readerCacheKey, {
      hasLoadedList: patch.hasLoadedList ?? prev.hasLoadedList,
      cards: patch.cards ?? prev.cards,
      nextOffset: patch.nextOffset ?? prev.nextOffset,
      total: patch.total ?? prev.total,
      hasMore: patch.hasMore ?? prev.hasMore,
      scrollTop: patch.scrollTop ?? prev.scrollTop,
    });
  }, [readerCacheKey]);

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
        builtInType: 'AUDIO',
        offset,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;

      const rawCards: AudioArchiveCard[] = page.items.map(item => ({
        id: Number(item.id),
        title: String(item.name || ''),
        sortOrder: Number(item.sortOrder ?? 0),
      }));

      setCards((prev) => {
        const merged = append ? [...prev, ...rawCards] : rawCards;
        const byId = new Map<number, AudioArchiveCard>();
        merged.forEach((card) => {
          byId.set(card.id, card);
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
      runtimeLogger.error('加载音频归档分页失败:', loadError);
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
  }, [folderNodeId, libraryId]);

  const loadMore = useCallback(() => {
    if (listLoading || loadingMore || !hasMore) return;
    void loadPage(nextOffset, true);
  }, [hasMore, listLoading, loadingMore, loadPage, nextOffset]);

  const handleOpenCard = useCallback(async (card: AudioArchiveCard) => {
    if (!libraryId) {
      Toast.error('当前库参数异常');
      return;
    }
    try {
      const nextUrl = await getFileLink(card.id, libraryId, LINK_EXPIRY_MINUTES);
      if (!nextUrl) {
        throw new Error('未获取到音频访问链接');
      }
      setFileUrl(
        nextUrl,
        card.title,
        'audio',
        card.id,
        {
          tabTypeLabel: 'AUDIO',
          returnTarget: {
            fileUrl,
            fileName: fileName || title,
            fileType: 'audio_archive',
            nodeId: folderNodeId,
            tabTypeLabel: 'AUDIO-ARCHIVE',
          },
        },
      );
    } catch (error: any) {
      runtimeLogger.error('打开音频归档卡片失败:', error);
      Toast.error(error?.message || '打开音频失败');
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
      return;
    }

    const cached = readerCacheKey ? audioArchiveSnapshotCache.get(readerCacheKey) : null;
    if (cached?.hasLoadedList) {
      setCards(cached.cards);
      setNextOffset(cached.nextOffset);
      setTotal(cached.total);
      setHasMore(cached.hasMore);
      setHasLoadedList(true);
      setError(null);
      restoreScrollTopRef.current = cached.scrollTop;
      return;
    }

    setHasLoadedList(false);
    setCards([]);
    setNextOffset(0);
    setTotal(0);
    setHasMore(false);
    void loadPage(0, false);
  }, [folderNodeId, libraryId, loadPage, readerCacheKey]);

  useEffect(() => {
    if (!active) return;
    const nextScrollTop = restoreScrollTopRef.current;
    if (nextScrollTop == null) return;
    restoreScrollTopRef.current = null;
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollTop = nextScrollTop;
      }
    });
  }, [active, cards.length, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleScroll = () => {
      if (persistScrollRafRef.current) return;
      persistScrollRafRef.current = window.requestAnimationFrame(() => {
        persistScrollRafRef.current = 0;
        persistSnapshot({
          hasLoadedList,
          cards,
          nextOffset,
          total,
          hasMore,
          scrollTop: viewport.scrollTop,
        });
      });
    };
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
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
    <AudioArchiveViewerWrapper style={wrapperStyle}>
      <div className="table-surface" ref={viewportRef as React.RefObject<HTMLDivElement>}>
        {listLoading ? (
          <div className="state-wrap">
            <Spin size="large" tip="归档加载中..." />
          </div>
        ) : error ? (
          <div className="state-wrap state-error">{error}</div>
        ) : cards.length === 0 ? (
          <div className="state-wrap">当前归档下暂无可展示的音频资源</div>
        ) : (
          <>
            <div className="cards-grid">
              {cards.map(card => (
                <article
                  key={card.id}
                  className="archive-card"
                  onDoubleClick={() => {
                    void handleOpenCard(card);
                  }}
                >
                  <div className="card-cover">
                    <div className="card-cover-fallback" aria-hidden>
                      <span className="card-cover-icon">AUDIO</span>
                    </div>
                  </div>
                  <div className="card-meta">
                    <div className="card-tag-row">
                      <span className="card-tag-pill">AUDIO</span>
                      <span className="card-open-hint">双击打开</span>
                    </div>
                    <p className="card-title" title={card.title}>{card.title}</p>
                    <div className="card-footer">
                      <span>节点 #{card.id}</span>
                      <span>音频资源</span>
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
          <span className="badge">AUDIO ARCHIVE</span>
          <span className="title" title={title}>{title}</span>
        </div>
        <div className="archive-count">
          共 {total} 项
        </div>
      </footer>
    </AudioArchiveViewerWrapper>
  );
};

export default AudioArchiveViewer;
