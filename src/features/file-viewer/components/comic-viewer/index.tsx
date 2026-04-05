import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import { getChildrenByNodeId, getFileLink } from '@/features/file-explorer/services/file.api';
import { ComicViewerWrapper } from './style';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface ComicViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
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

const INITIAL_VISIBLE_COUNT = 8;
const LOAD_MORE_STEP = 6;
const PREFETCH_AHEAD = 6;
const MAX_RESOLVE_PER_TICK = 8;
const MIN_PAGE_WIDTH = 360;
const MAX_PAGE_WIDTH = 980;

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif']);

function normalizeExt(ext?: string): string {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

function isImageNode(item: ComicChildNode): boolean {
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

function parseComicLibraryId(fileUrl: string): number | null {
  const matches = /^comic:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

const ComicViewer: React.FC<ComicViewerProps> = ({ folderNodeId, fileUrl, fileName }) => {
  const libraryId = useMemo(() => parseComicLibraryId(fileUrl), [fileUrl]);

  const [pages, setPages] = useState<ComicPageItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef(0);

  useEffect(() => {
    const currentSession = sessionRef.current + 1;
    sessionRef.current = currentSession;

    if (!folderNodeId || !Number.isFinite(folderNodeId) || !libraryId || !Number.isFinite(libraryId)) {
      setPages([]);
      setVisibleCount(0);
      setListError('漫画目录参数异常');
      return;
    }

    let mounted = true;
    setListLoading(true);
    setListError(null);
    setPages([]);
    setVisibleCount(0);

    const loadComicList = async () => {
      try {
        const children = (await getChildrenByNodeId(folderNodeId, libraryId)) as ComicChildNode[];
        if (!mounted || sessionRef.current !== currentSession) {
          return;
        }
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
        setPages(imagePages);
        setVisibleCount(Math.min(INITIAL_VISIBLE_COUNT, imagePages.length));
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
  }, [folderNodeId, libraryId]);

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

  const renderedPages = pages.slice(0, visibleCount);

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
      <div className="viewer-header">
        <div className="title-group">
          <span className="title-badge">COMIC</span>
          <span className="title">{fileName || '漫画预览'}</span>
        </div>
        <div className="header-meta">{renderedPages.length} / {pages.length} 页</div>
      </div>

      <div className="pages-scroll" ref={scrollRef}>
        <div className="pages-column" style={{ width: `${pageWidth}px` }}>
          {renderedPages.map((page, index) => (
            <article className="page-shell" style={{ width: `${pageWidth}px` }} key={page.id}>
              {page.status === 'ready' && page.url ? (
                <img
                  className="page-image"
                  src={page.url}
                  alt={page.name}
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className="page-skeleton">
                  {page.status === 'error' ? '加载失败' : <Spin size="middle" />}
                </div>
              )}
              <div className="page-caption">
                <span>第 {index + 1} 页</span>
                <span title={page.name}>{page.name}</span>
              </div>
            </article>
          ))}
          <div ref={sentinelRef} className="load-more-sentinel" />
          <div className="load-state">
            {visibleCount < pages.length ? '继续下滑加载更多页...' : '已加载全部页面'}
          </div>
        </div>
      </div>
    </ComicViewerWrapper>
  );
};

export default ComicViewer;
