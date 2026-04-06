import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InputNumber, Spin } from '@douyinfe/semi-ui';
import { IconMinus, IconPlus } from '@douyinfe/semi-icons';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { PdfViewerWrapper } from './style';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface PdfViewerProps {
  nodeId: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
}

interface PdfViewerSnapshot {
  currentPage: number;
  zoom: number;
  scrollTop: number;
  scrollRatio: number;
  anchorPage: number;
  anchorOffsetRatio: number;
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  stageWidth: number;
  zoom: number;
  onRendered: (pageNumber: number, renderedHeight: number) => void;
  assignShellRef: (pageNumber: number, element: HTMLElement | null) => void;
}

const PDF_VIEWER_CACHE_MAX_ENTRIES = 24;
const pdfViewerSnapshotCache = new Map<string, PdfViewerSnapshot>();

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 0.15;
const PAGE_HORIZONTAL_PADDING = 32;
const RESIZE_RENDER_DEBOUNCE_MS = 160;

const WINDOW_PAGES_BEFORE = 8;
const WINDOW_PAGES_AFTER = 14;
const DEFAULT_ESTIMATED_PAGE_HEIGHT = 1120;
const PAGE_FRAME_EXTRA_HEIGHT = 30;

const pdfWorkerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
if (GlobalWorkerOptions.workerSrc !== pdfWorkerSrc) {
  GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function normalizeZoom(value: number): number {
  const fixed = Number(value.toFixed(2));
  return clamp(fixed, MIN_ZOOM, MAX_ZOOM);
}

function resolveViewerCacheKey(url: string, nodeId: number | null): string {
  if (nodeId !== null && nodeId !== undefined) {
    return `node:${nodeId}`;
  }
  return `url:${String(url || '').trim()}`;
}

function setPdfViewerSnapshot(cacheKey: string, snapshot: PdfViewerSnapshot) {
  if (pdfViewerSnapshotCache.has(cacheKey)) {
    pdfViewerSnapshotCache.delete(cacheKey);
  }
  pdfViewerSnapshotCache.set(cacheKey, snapshot);
  if (pdfViewerSnapshotCache.size > PDF_VIEWER_CACHE_MAX_ENTRIES) {
    const oldestKey = pdfViewerSnapshotCache.keys().next().value;
    if (oldestKey) {
      pdfViewerSnapshotCache.delete(oldestKey);
    }
  }
}

function resolveCurrentPageFromRenderedRefs(
  stageElement: HTMLDivElement,
  pageShellRefs: Map<number, HTMLElement>,
  fallbackPage: number,
): number {
  const anchorTop = stageElement.scrollTop + Math.max(stageElement.clientHeight * 0.25, 48);
  let bestPage = fallbackPage;
  let bestDistance = Number.POSITIVE_INFINITY;

  pageShellRefs.forEach((shell, pageNumber) => {
    const distance = Math.abs(shell.offsetTop - anchorTop);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = pageNumber;
    }
  });

  return bestPage;
}

function resolveViewportAnchor(
  stageElement: HTMLDivElement,
  pageShellRefs: Map<number, HTMLElement>,
  fallbackPage: number,
): { pageNumber: number; offsetRatio: number } {
  const viewportTop = Math.max(stageElement.scrollTop, 0);
  const measured = Array.from(pageShellRefs.entries())
    .map(([pageNumber, shell]) => ({
      pageNumber,
      top: Math.max(shell.offsetTop, 0),
      height: Math.max(shell.offsetHeight, 1),
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  if (measured.length === 0) {
    const safeFallback = Math.max(Math.floor(fallbackPage), 1);
    return {
      pageNumber: safeFallback,
      offsetRatio: 0,
    };
  }

  let active = measured.find((item) => viewportTop >= item.top && viewportTop < item.top + item.height);
  if (!active) {
    active = viewportTop < measured[0].top
      ? measured[0]
      : measured[measured.length - 1];
  }

  return {
    pageNumber: active.pageNumber,
    offsetRatio: normalizeRatio((viewportTop - active.top) / active.height),
  };
}

function estimateCurrentPageByScroll(
  scrollTop: number,
  viewportHeight: number,
  numPages: number,
  averagePageHeight: number,
): number {
  if (numPages <= 0) return 1;
  const normalizedAverageHeight = Math.max(averagePageHeight, 240);
  const anchorTop = Math.max(scrollTop, 0) + Math.max(viewportHeight * 0.25, 48);
  const roughPage = Math.floor(anchorTop / normalizedAverageHeight) + 1;
  return clamp(roughPage, 1, numPages);
}

function estimateOffsetBeforePage(
  pageNumber: number,
  averagePageHeight: number,
  pageHeightByPage: Map<number, number>,
): number {
  const target = Math.max(Math.floor(pageNumber), 1);
  const normalizedAverageHeight = Math.max(averagePageHeight, 240);
  let offset = (target - 1) * normalizedAverageHeight;

  pageHeightByPage.forEach((height, page) => {
    if (page < target) {
      offset += height - normalizedAverageHeight;
    }
  });

  return Math.max(offset, 0);
}

function resolveVirtualSpacerHeights(
  renderStartPage: number,
  renderEndPage: number,
  numPages: number,
  averagePageHeight: number,
  pageHeightByPage: Map<number, number>,
): { top: number; bottom: number } {
  if (numPages <= 0) {
    return { top: 0, bottom: 0 };
  }

  const top = renderStartPage > 1
    ? estimateOffsetBeforePage(renderStartPage, averagePageHeight, pageHeightByPage)
    : 0;

  const normalizedAverageHeight = Math.max(averagePageHeight, 240);
  let bottom = renderEndPage < numPages
    ? (numPages - renderEndPage) * normalizedAverageHeight
    : 0;
  if (bottom > 0) {
    pageHeightByPage.forEach((height, page) => {
      if (page > renderEndPage) {
        bottom += height - normalizedAverageHeight;
      }
    });
  }

  return {
    top: Math.max(top, 0),
    bottom: Math.max(bottom, 0),
  };
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  stageWidth,
  zoom,
  onRendered,
  assignShellRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) {
      setHasError(true);
      return;
    }

    let active = true;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    setHasError(false);
    setIsRendering(true);

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (!active) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const maxWidth = Math.max(stageWidth - PAGE_HORIZONTAL_PADDING, 240);
        const fitScale = maxWidth / baseViewport.width;
        const renderScale = Math.max(fitScale * zoom, 0.2);
        const cssViewport = page.getViewport({ scale: renderScale });
        const ratio = window.devicePixelRatio || 1;
        const pixelViewport = page.getViewport({ scale: renderScale * ratio });

        canvas.width = Math.max(Math.floor(pixelViewport.width), 1);
        canvas.height = Math.max(Math.floor(pixelViewport.height), 1);
        canvas.style.width = `${Math.max(Math.floor(cssViewport.width), 1)}px`;
        canvas.style.height = `${Math.max(Math.floor(cssViewport.height), 1)}px`;

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({
          canvasContext: context,
          viewport: pixelViewport,
        });
        await renderTask.promise;
        if (!active) return;

        const renderedHeight = Math.max(Math.ceil(cssViewport.height) + PAGE_FRAME_EXTRA_HEIGHT, 240);
        setHasRenderedOnce(true);
        setHasError(false);
        onRendered(pageNumber, renderedHeight);
      } catch (error: unknown) {
        const errorName = error && typeof error === 'object' && 'name' in error
          ? String((error as { name?: string }).name || '')
          : '';
        if (errorName === 'RenderingCancelledException') {
          return;
        }
        runtimeLogger.error(`PDF 页面渲染失败(page=${pageNumber}):`, error);
        if (!active) return;
        setHasError(true);
      } finally {
        if (active) {
          setIsRendering(false);
        }
      }
    })();

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [onRendered, pageNumber, pdfDoc, stageWidth, zoom]);

  return (
    <article className="page-shell" ref={(element) => assignShellRef(pageNumber, element)}>
      <div className="page-frame">
        {hasError ? (
          <div className="page-error">第 {pageNumber} 页渲染失败</div>
        ) : (
          <>
            {isRendering && !hasRenderedOnce ? (
              <div className="page-loading">
                <Spin size="middle" />
              </div>
            ) : null}
            <canvas className="pdf-canvas" ref={canvasRef} />
          </>
        )}
      </div>
      <div className="page-caption">第 {pageNumber} 页</div>
    </article>
  );
};

const PdfViewer: React.FC<PdfViewerProps> = ({ nodeId, url, fileName, active = true }) => {
  const viewerCacheKey = useMemo(() => resolveViewerCacheKey(url, nodeId), [url, nodeId]);
  const initialSnapshot = useMemo(
    () => pdfViewerSnapshotCache.get(viewerCacheKey) ?? null,
    [viewerCacheKey],
  );

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialSnapshot?.currentPage ?? 1);
  const [zoom, setZoom] = useState(normalizeZoom(initialSnapshot?.zoom ?? 1));
  const [stageMeasuredWidth, setStageMeasuredWidth] = useState(0);
  const [stageRenderWidth, setStageRenderWidth] = useState(0);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [restoreTick, setRestoreTick] = useState(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageShellRefs = useRef<Map<number, HTMLElement>>(new Map());
  const pageHeightByPageRef = useRef<Map<number, number>>(new Map());
  const averagePageHeightRef = useRef(DEFAULT_ESTIMATED_PAGE_HEIGHT);

  const pendingRestoreRef = useRef<{
    desiredScrollTop: number;
    desiredScrollRatio: number;
    anchorPage: number;
    anchorOffsetRatio: number;
    attempts: number;
  } | null>(null);
  const pendingJumpPageRef = useRef<number | null>(null);
  const currentPageRef = useRef(currentPage);
  const zoomRef = useRef(zoom);
  const scrollTopRef = useRef(initialSnapshot?.scrollTop ?? 0);
  const anchorPageRef = useRef(initialSnapshot?.anchorPage ?? initialSnapshot?.currentPage ?? 1);
  const anchorOffsetRatioRef = useRef(normalizeRatio(initialSnapshot?.anchorOffsetRatio ?? 0));
  const hasScrollMutationRef = useRef(false);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const persistViewerSnapshot = useCallback((patch?: Partial<PdfViewerSnapshot>) => {
    const previous = pdfViewerSnapshotCache.get(viewerCacheKey);
    setPdfViewerSnapshot(viewerCacheKey, {
      currentPage: patch?.currentPage ?? previous?.currentPage ?? currentPageRef.current,
      zoom: patch?.zoom ?? previous?.zoom ?? zoomRef.current,
      scrollTop: patch?.scrollTop ?? previous?.scrollTop ?? scrollTopRef.current,
      scrollRatio: normalizeRatio(patch?.scrollRatio ?? previous?.scrollRatio ?? 0),
      anchorPage: patch?.anchorPage ?? previous?.anchorPage ?? anchorPageRef.current ?? currentPageRef.current,
      anchorOffsetRatio: normalizeRatio(
        patch?.anchorOffsetRatio ?? previous?.anchorOffsetRatio ?? anchorOffsetRatioRef.current,
      ),
    });
  }, [viewerCacheKey]);

  useEffect(() => {
    const snapshot = pdfViewerSnapshotCache.get(viewerCacheKey);
    setCurrentPage(snapshot?.currentPage ?? 1);
    setZoom(normalizeZoom(snapshot?.zoom ?? 1));
    scrollTopRef.current = snapshot?.scrollTop ?? 0;
    anchorPageRef.current = snapshot?.anchorPage ?? snapshot?.currentPage ?? 1;
    anchorOffsetRatioRef.current = normalizeRatio(snapshot?.anchorOffsetRatio ?? 0);
  }, [viewerCacheKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageMeasuredWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(stage);
    setStageMeasuredWidth(Math.round(stage.clientWidth));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (stageMeasuredWidth <= 0) return;
    if (stageRenderWidth <= 0) {
      setStageRenderWidth(stageMeasuredWidth);
      return;
    }

    const timer = window.setTimeout(() => {
      setStageRenderWidth(stageMeasuredWidth);
    }, RESIZE_RENDER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [stageMeasuredWidth, stageRenderWidth]);

  useEffect(() => {
    pageHeightByPageRef.current.clear();
    averagePageHeightRef.current = DEFAULT_ESTIMATED_PAGE_HEIGHT;
    setLayoutRevision((prev) => prev + 1);
  }, [stageRenderWidth, zoom]);

  useEffect(() => {
    let active = true;
    const loadingTask = getDocument(url);
    const cachedSnapshot = pdfViewerSnapshotCache.get(viewerCacheKey);

    setErrorMessage(null);
    setIsDocumentLoading(true);
    setPdfDoc(null);
    setNumPages(0);
    pageShellRefs.current.clear();
    pageHeightByPageRef.current.clear();
    averagePageHeightRef.current = DEFAULT_ESTIMATED_PAGE_HEIGHT;
    pendingRestoreRef.current = null;
    pendingJumpPageRef.current = null;

    loadingTask.promise
      .then((doc) => {
        if (!active) {
          void doc.destroy();
          return;
        }
        const total = Math.max(doc.numPages, 1);
        const restoredPage = clamp(cachedSnapshot?.currentPage ?? 1, 1, total);

        setPdfDoc(doc);
        setNumPages(total);
        setCurrentPage(restoredPage);
        setIsDocumentLoading(false);
        setErrorMessage(null);
        setLayoutRevision((prev) => prev + 1);

        if (cachedSnapshot) {
          pendingRestoreRef.current = {
            desiredScrollTop: Number(cachedSnapshot?.scrollTop ?? 0),
            desiredScrollRatio: normalizeRatio(cachedSnapshot?.scrollRatio ?? 0),
            anchorPage: clamp(
              Math.round(cachedSnapshot?.anchorPage ?? cachedSnapshot?.currentPage ?? 1),
              1,
              total,
            ),
            anchorOffsetRatio: normalizeRatio(cachedSnapshot?.anchorOffsetRatio ?? 0),
            attempts: 0,
          };
          setRestoreTick((prev) => prev + 1);
        }
      })
      .catch((error) => {
        runtimeLogger.error('PDF 文档加载失败:', error);
        if (!active) return;
        setPdfDoc(null);
        setNumPages(0);
        setErrorMessage('PDF 加载失败');
        setIsDocumentLoading(false);
      });

    return () => {
      active = false;
      loadingTask.destroy();
    };
  }, [url, viewerCacheKey]);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  useEffect(() => {
    persistViewerSnapshot({
      currentPage,
      zoom,
      anchorPage: currentPage,
    });
  }, [currentPage, zoom, persistViewerSnapshot]);

  const renderStartPage = useMemo(
    () => (numPages > 0 ? clamp(currentPage - WINDOW_PAGES_BEFORE, 1, numPages) : 1),
    [currentPage, numPages],
  );
  const renderEndPage = useMemo(
    () => (numPages > 0 ? clamp(currentPage + WINDOW_PAGES_AFTER, 1, numPages) : 1),
    [currentPage, numPages],
  );

  const computeScrollTopForPageStart = useCallback((targetPage: number) => {
    return estimateOffsetBeforePage(
      targetPage,
      averagePageHeightRef.current,
      pageHeightByPageRef.current,
    );
  }, []);

  const { top: topSpacerHeight, bottom: bottomSpacerHeight } = resolveVirtualSpacerHeights(
    renderStartPage,
    renderEndPage,
    numPages,
    averagePageHeightRef.current,
    pageHeightByPageRef.current,
  );

  const renderedPageNumbers = useMemo(() => {
    if (numPages <= 0) return [] as number[];
    const size = Math.max(renderEndPage - renderStartPage + 1, 0);
    return Array.from({ length: size }, (_, index) => renderStartPage + index);
  }, [numPages, renderEndPage, renderStartPage]);

  const handlePageRendered = useCallback((pageNumber: number, renderedHeight: number) => {
    if (!Number.isFinite(renderedHeight) || renderedHeight <= 0) return;
    const previous = pageHeightByPageRef.current.get(pageNumber);
    if (previous !== undefined && Math.abs(previous - renderedHeight) <= 1) {
      return;
    }

    pageHeightByPageRef.current.set(pageNumber, renderedHeight);
    const heights = Array.from(pageHeightByPageRef.current.values());
    if (heights.length > 0) {
      const total = heights.reduce((sum, value) => sum + value, 0);
      averagePageHeightRef.current = total / heights.length;
    }
    setLayoutRevision((prev) => prev + 1);

    if (pendingRestoreRef.current || pendingJumpPageRef.current) {
      setRestoreTick((prev) => prev + 1);
    }
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || numPages <= 0) return;
    hasScrollMutationRef.current = false;

    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        hasScrollMutationRef.current = true;
        const nextScrollTop = Math.max(stage.scrollTop, 0);
        const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
        const nextScrollRatio = maxScrollable > 0
          ? normalizeRatio(nextScrollTop / maxScrollable)
          : 0;
        scrollTopRef.current = nextScrollTop;

        const anchorSnapshot = resolveViewportAnchor(stage, pageShellRefs.current, currentPageRef.current);
        anchorPageRef.current = anchorSnapshot.pageNumber;
        anchorOffsetRatioRef.current = anchorSnapshot.offsetRatio;

        const estimatedPage = estimateCurrentPageByScroll(
          nextScrollTop,
          stage.clientHeight,
          numPages,
          averagePageHeightRef.current,
        );
        const nextCurrentPage = resolveCurrentPageFromRenderedRefs(
          stage,
          pageShellRefs.current,
          anchorSnapshot.pageNumber || estimatedPage,
        );
        if (nextCurrentPage !== currentPageRef.current) {
          setCurrentPage(nextCurrentPage);
        }
        persistViewerSnapshot({
          scrollTop: nextScrollTop,
          scrollRatio: nextScrollRatio,
          currentPage: nextCurrentPage,
          anchorPage: anchorSnapshot.pageNumber,
          anchorOffsetRatio: anchorSnapshot.offsetRatio,
        });
      });
    };

    stage.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      stage.removeEventListener('scroll', onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      const finalScrollTop = Math.max(stage.scrollTop, 0);
      const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
      const finalScrollRatio = maxScrollable > 0
        ? normalizeRatio(finalScrollTop / maxScrollable)
        : 0;
      const previous = pdfViewerSnapshotCache.get(viewerCacheKey);
      const shouldSkipZeroOverwrite = (
        !hasScrollMutationRef.current
        && finalScrollTop <= 1
        && Boolean(previous)
        && (
          Number(previous?.scrollTop ?? 0) > 1
          || normalizeRatio(previous?.scrollRatio ?? 0) > 0
          || Number(previous?.anchorPage ?? 1) > 1
          || normalizeRatio(previous?.anchorOffsetRatio ?? 0) > 0
        )
      );
      if (shouldSkipZeroOverwrite) {
        return;
      }
      scrollTopRef.current = finalScrollTop;
      const anchorPage = anchorPageRef.current || currentPageRef.current;
      const anchorOffsetRatio = normalizeRatio(anchorOffsetRatioRef.current);
      persistViewerSnapshot({
        scrollTop: finalScrollTop,
        scrollRatio: finalScrollRatio,
        anchorPage,
        anchorOffsetRatio,
      });
    };
  }, [numPages, persistViewerSnapshot, viewerCacheKey]);

  const jumpToPage = useCallback((value: number) => {
    if (numPages <= 0) return;
    const targetPage = clamp(Math.round(value), 1, numPages);
    pendingJumpPageRef.current = targetPage;
    setCurrentPage(targetPage);
    setRestoreTick((prev) => prev + 1);
  }, [numPages]);

  useEffect(() => {
    const targetPage = pendingJumpPageRef.current;
    if (!targetPage) return;

    const stage = stageRef.current;
    if (!stage) return;

    const targetShell = pageShellRefs.current.get(targetPage);
    const nextTop = targetShell
      ? Math.max(targetShell.offsetTop - 8, 0)
      : computeScrollTopForPageStart(targetPage);

    stage.scrollTo({ top: nextTop, behavior: 'smooth' });
    scrollTopRef.current = nextTop;
    anchorPageRef.current = targetPage;
    anchorOffsetRatioRef.current = 0;
    const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
    const nextScrollRatio = maxScrollable > 0
      ? normalizeRatio(nextTop / maxScrollable)
      : 0;
    persistViewerSnapshot({
      currentPage: targetPage,
      scrollTop: nextTop,
      scrollRatio: nextScrollRatio,
      anchorPage: targetPage,
      anchorOffsetRatio: 0,
    });
    pendingJumpPageRef.current = null;
  }, [computeScrollTopForPageStart, persistViewerSnapshot, restoreTick]);

  useEffect(() => {
    const pendingRestore = pendingRestoreRef.current;
    const stage = stageRef.current;
    if (!pendingRestore || !stage) return;

    const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
    const targetShell = pageShellRefs.current.get(pendingRestore.anchorPage);
    const anchorTargetTop = targetShell
      ? Math.max(
        targetShell.offsetTop + Math.max(targetShell.offsetHeight, 1) * pendingRestore.anchorOffsetRatio,
        0,
      )
      : null;
    const ratioTop = pendingRestore.desiredScrollRatio > 0
      ? pendingRestore.desiredScrollRatio * maxScrollable
      : 0;
    const desiredTop = anchorTargetTop ?? Math.max(pendingRestore.desiredScrollTop, ratioTop, 0);
    const targetTop = Math.min(desiredTop, maxScrollable);

    stage.scrollTop = targetTop;
    scrollTopRef.current = stage.scrollTop;
    const anchorSnapshot = resolveViewportAnchor(stage, pageShellRefs.current, currentPageRef.current);
    anchorPageRef.current = anchorSnapshot.pageNumber;
    anchorOffsetRatioRef.current = anchorSnapshot.offsetRatio;

    const reachedDesiredPosition = Math.abs(stage.scrollTop - targetTop) <= 1
      && (anchorTargetTop !== null || desiredTop <= maxScrollable);
    if (reachedDesiredPosition || pendingRestore.attempts >= 80) {
      pendingRestoreRef.current = null;
      const derivedPage = resolveCurrentPageFromRenderedRefs(
        stage,
        pageShellRefs.current,
        anchorSnapshot.pageNumber || currentPageRef.current,
      );
      setCurrentPage(derivedPage);
      const finalMaxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
      const finalScrollRatio = finalMaxScrollable > 0
        ? normalizeRatio(stage.scrollTop / finalMaxScrollable)
        : 0;
      persistViewerSnapshot({
        scrollTop: stage.scrollTop,
        scrollRatio: finalScrollRatio,
        currentPage: derivedPage,
        anchorPage: anchorSnapshot.pageNumber,
        anchorOffsetRatio: anchorSnapshot.offsetRatio,
      });
      return;
    }

    pendingRestore.attempts += 1;
    const timer = window.setTimeout(() => {
      setRestoreTick((prev) => prev + 1);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [layoutRevision, numPages, persistViewerSnapshot, restoreTick, stageRenderWidth, zoom]);

  useEffect(() => {
    if (!active) return;
    const snapshot = pdfViewerSnapshotCache.get(viewerCacheKey);
    if (!snapshot || numPages <= 0) {
      return;
    }
    pendingRestoreRef.current = {
      desiredScrollTop: Number(snapshot.scrollTop ?? 0),
      desiredScrollRatio: normalizeRatio(snapshot.scrollRatio ?? 0),
      anchorPage: clamp(Math.round(snapshot.anchorPage ?? snapshot.currentPage ?? 1), 1, numPages),
      anchorOffsetRatio: normalizeRatio(snapshot.anchorOffsetRatio ?? 0),
      attempts: 0,
    };
    setRestoreTick((prev) => prev + 1);
  }, [active, numPages, viewerCacheKey]);

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < numPages;

  return (
    <PdfViewerWrapper>
      <div className="viewer-stage" ref={stageRef}>
        {isDocumentLoading ? (
          <div className="loading-mask">
            <Spin size="large" tip="PDF 加载中..." />
          </div>
        ) : null}

        {errorMessage ? (
          <div className="state-error">{errorMessage}</div>
        ) : !pdfDoc ? (
          <div className="state-empty">PDF 预览初始化中...</div>
        ) : (
          <div className="pages-column">
            {topSpacerHeight > 0 ? <div className="virtual-spacer" style={{ height: `${topSpacerHeight}px` }} /> : null}
            {renderedPageNumbers.map((pageNumber) => (
              <PdfPageCanvas
                key={pageNumber}
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                stageWidth={stageRenderWidth}
                zoom={zoom}
                onRendered={handlePageRendered}
                assignShellRef={(resolvedPage, element) => {
                  if (element) {
                    pageShellRefs.current.set(resolvedPage, element);
                  } else {
                    pageShellRefs.current.delete(resolvedPage);
                  }
                }}
              />
            ))}
            {bottomSpacerHeight > 0 ? <div className="virtual-spacer" style={{ height: `${bottomSpacerHeight}px` }} /> : null}
          </div>
        )}
      </div>

      <div className="viewer-footer">
        <div className="footer-title-group">
          <span className="title-badge">PDF</span>
          <span className="title" title={fileName || 'PDF 预览'}>
            {fileName || 'PDF 预览'}
          </span>
        </div>

        <div className="footer-controls">
          <Button
            size="small"
            theme="borderless"
            disabled={!canGoPrevious}
            onClick={() => jumpToPage(currentPage - 1)}
          >
            上一页
          </Button>
          <InputNumber
            size="small"
            min={1}
            max={Math.max(numPages, 1)}
            value={currentPage}
            disabled={numPages <= 0}
            style={{ width: 72 }}
            onChange={(value) => {
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) return;
              jumpToPage(parsed);
            }}
          />
          <span className="meta-text">/ {numPages || '-'}</span>
          <Button
            size="small"
            theme="borderless"
            disabled={!canGoNext}
            onClick={() => jumpToPage(currentPage + 1)}
          >
            下一页
          </Button>
          <Button
            size="small"
            icon={<IconMinus />}
            theme="borderless"
            onClick={() => setZoom((prev) => normalizeZoom(prev - ZOOM_STEP))}
          />
          <span className="meta-text zoom-text">{Math.round(zoom * 100)}%</span>
          <Button
            size="small"
            icon={<IconPlus />}
            theme="borderless"
            onClick={() => setZoom((prev) => normalizeZoom(prev + ZOOM_STEP))}
          />
        </div>

        <div className="footer-actions">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="action-link"
          >
            新窗口打开
          </a>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="action-link"
            download={fileName || undefined}
          >
            下载
          </a>
        </div>
      </div>
    </PdfViewerWrapper>
  );
};

export default PdfViewer;
