import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InputNumber, Spin } from '@douyinfe/semi-ui';
import { IconMinus, IconPlus } from '@douyinfe/semi-icons';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { PdfViewerWrapper } from './style';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  PDF_VIEWER_SESSION_ESTIMATED_BYTES,
  PDF_VIEWER_SESSION_SCHEMA_VERSION,
  parsePdfViewerSnapshot,
  type PdfViewerSnapshot,
} from './pdf-viewer-session';
import {
  isPdfAnchorLayoutSettled,
  isPdfPageJumpSettled,
  resolvePdfPageJumpTarget,
  resolvePdfViewportAnchor,
} from './pdf-viewer-navigation';
import { useViewerSession, type ViewerSessionAdapter } from '@/features/file-viewer/session';

interface PdfViewerProps {
  accountScope: string | null;
  libraryId: number | null;
  nodeId: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  contentRevision: string | null;
  reloadToken?: number;
  tabId: string;
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  stageWidth: number;
  zoom: number;
  onRendered: (pageNumber: number, renderedHeight: number) => void;
  assignShellRef: (pageNumber: number, element: HTMLElement | null) => void;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 0.15;
const PAGE_HORIZONTAL_PADDING = 32;
const RESIZE_RENDER_DEBOUNCE_MS = 160;

const WINDOW_PAGES_BEFORE = 8;
const WINDOW_PAGES_AFTER = 14;
const DEFAULT_ESTIMATED_PAGE_HEIGHT = 1120;
const PAGE_FRAME_EXTRA_HEIGHT = 30;
const PAGE_JUMP_MAX_ATTEMPTS = 80;
const PAGE_JUMP_RETRY_MS = 80;

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

  return resolvePdfViewportAnchor(viewportTop, measured, fallbackPage);
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

const PdfViewer: React.FC<PdfViewerProps> = ({
  accountScope,
  active = true,
  contentRevision,
  fileName,
  libraryId,
  nodeId,
  reloadToken = 0,
  tabId,
  url,
}) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
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
  const pendingJumpPageRef = useRef<{ pageNumber: number; attempts: number } | null>(null);
  const currentPageRef = useRef(currentPage);
  const zoomRef = useRef(zoom);
  const scrollTopRef = useRef(0);
  const scrollRatioRef = useRef(0);
  const anchorPageRef = useRef(1);
  const anchorOffsetRatioRef = useRef(0);
  const activeRef = useRef(active);
  const numPagesRef = useRef(0);
  const latestSnapshotRef = useRef<PdfViewerSnapshot | null>(null);
  const pendingStateHydrationRef = useRef(false);
  const hasScrollMutationRef = useRef(false);
  activeRef.current = active;

  const capturePdfSnapshot = useCallback((): PdfViewerSnapshot => {
    const snapshot = {
      currentPage: Math.max(Math.round(currentPageRef.current), 1),
      zoom: normalizeZoom(zoomRef.current),
      scrollTop: Math.max(scrollTopRef.current, 0),
      scrollRatio: normalizeRatio(scrollRatioRef.current),
      anchorPage: Math.max(Math.round(anchorPageRef.current || currentPageRef.current), 1),
      anchorOffsetRatio: normalizeRatio(anchorOffsetRatioRef.current),
    };
    latestSnapshotRef.current = snapshot;
    return snapshot;
  }, []);

  const restorePdfSnapshot = useCallback((payload: PdfViewerSnapshot) => {
    const snapshot = parsePdfViewerSnapshot(payload);
    if (!snapshot) return;
    latestSnapshotRef.current = snapshot;
    pendingStateHydrationRef.current = true;
    const total = numPagesRef.current;
    const restoredPage = total > 0 ? clamp(snapshot.currentPage, 1, total) : snapshot.currentPage;
    currentPageRef.current = restoredPage;
    zoomRef.current = normalizeZoom(snapshot.zoom);
    scrollTopRef.current = snapshot.scrollTop;
    scrollRatioRef.current = snapshot.scrollRatio;
    anchorPageRef.current = snapshot.anchorPage;
    anchorOffsetRatioRef.current = snapshot.anchorOffsetRatio;
    if (total > 0) {
      setCurrentPage(restoredPage);
    }
    setZoom(normalizeZoom(snapshot.zoom));

    if (total > 0) {
      pendingRestoreRef.current = {
        desiredScrollTop: snapshot.scrollTop,
        desiredScrollRatio: snapshot.scrollRatio,
        anchorPage: clamp(snapshot.anchorPage, 1, total),
        anchorOffsetRatio: snapshot.anchorOffsetRatio,
        attempts: 0,
      };
      setRestoreTick((prev) => prev + 1);
    }
  }, []);

  const sessionAdapter = useMemo<ViewerSessionAdapter<PdfViewerSnapshot>>(() => ({
    capture: capturePdfSnapshot,
    restore: restorePdfSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateSnapshotBytes: () => PDF_VIEWER_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => (activeRef.current ? ['active'] : []),
  }), [capturePdfSnapshot, restorePdfSnapshot]);

  const { capture: captureSessionSnapshot } = useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId,
    reloadToken,
    schemaVersion: PDF_VIEWER_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'pdf',
  });

  const persistViewerSnapshot = useCallback((patch?: Partial<PdfViewerSnapshot>) => {
    if (patch?.currentPage !== undefined) currentPageRef.current = patch.currentPage;
    if (patch?.zoom !== undefined) zoomRef.current = patch.zoom;
    if (patch?.scrollTop !== undefined) scrollTopRef.current = patch.scrollTop;
    if (patch?.scrollRatio !== undefined) scrollRatioRef.current = normalizeRatio(patch.scrollRatio);
    if (patch?.anchorPage !== undefined) anchorPageRef.current = patch.anchorPage;
    if (patch?.anchorOffsetRatio !== undefined) {
      anchorOffsetRatioRef.current = normalizeRatio(patch.anchorOffsetRatio);
    }
    capturePdfSnapshot();
    captureSessionSnapshot();
  }, [capturePdfSnapshot, captureSessionSnapshot]);

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
    if (stageMeasuredWidth === stageRenderWidth) return;

    const timer = window.setTimeout(() => {
      const stage = stageRef.current;
      if (stage && numPagesRef.current > 0 && !pendingJumpPageRef.current) {
        if (!pendingRestoreRef.current) {
          const anchorSnapshot = resolveViewportAnchor(
            stage,
            pageShellRefs.current,
            currentPageRef.current,
          );
          const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
          const nextScrollTop = Math.max(stage.scrollTop, 0);
          const nextScrollRatio = maxScrollable > 0
            ? normalizeRatio(nextScrollTop / maxScrollable)
            : 0;

          pendingRestoreRef.current = {
            desiredScrollTop: nextScrollTop,
            desiredScrollRatio: nextScrollRatio,
            anchorPage: clamp(anchorSnapshot.pageNumber, 1, numPagesRef.current),
            anchorOffsetRatio: anchorSnapshot.offsetRatio,
            attempts: 0,
          };
          currentPageRef.current = anchorSnapshot.pageNumber;
          scrollTopRef.current = nextScrollTop;
          scrollRatioRef.current = nextScrollRatio;
          anchorPageRef.current = anchorSnapshot.pageNumber;
          anchorOffsetRatioRef.current = anchorSnapshot.offsetRatio;
          setCurrentPage(anchorSnapshot.pageNumber);
        } else {
          pendingRestoreRef.current.attempts = 0;
        }
      }
      setStageRenderWidth(stageMeasuredWidth);
      setRestoreTick((prev) => prev + 1);
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

    setErrorMessage(null);
    setIsDocumentLoading(true);
    setPdfDoc(null);
    setNumPages(0);
    numPagesRef.current = 0;
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
        const cachedSnapshot = latestSnapshotRef.current;
        const total = Math.max(doc.numPages, 1);
        const restoredPage = clamp(cachedSnapshot?.currentPage ?? 1, 1, total);

        setPdfDoc(doc);
        setNumPages(total);
        numPagesRef.current = total;
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
        if (!active) return;
        runtimeLogger.error('PDF 文档加载失败:', error);
        setPdfDoc(null);
        setNumPages(0);
        numPagesRef.current = 0;
        setErrorMessage('PDF 加载失败');
        setIsDocumentLoading(false);
      });

    return () => {
      active = false;
      loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  useEffect(() => {
    if (!pdfDoc) return;
    const restoredSnapshot = latestSnapshotRef.current;
    if (pendingStateHydrationRef.current && restoredSnapshot) {
      const expectedPage = clamp(restoredSnapshot.currentPage, 1, Math.max(numPages, 1));
      const expectedZoom = normalizeZoom(restoredSnapshot.zoom);
      if (currentPage !== expectedPage || normalizeZoom(zoom) !== expectedZoom) {
        return;
      }
      pendingStateHydrationRef.current = false;
    }
    persistViewerSnapshot({ currentPage, zoom });
  }, [currentPage, numPages, pdfDoc, persistViewerSnapshot, zoom]);

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

        if (pendingJumpPageRef.current || pendingRestoreRef.current) {
          scrollRatioRef.current = nextScrollRatio;
          return;
        }

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
      const previous = latestSnapshotRef.current;
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
  }, [numPages, persistViewerSnapshot]);

  const jumpToPage = useCallback((value: number) => {
    if (numPages <= 0) return;
    const targetPage = clamp(Math.round(value), 1, numPages);
    pendingRestoreRef.current = null;
    pendingJumpPageRef.current = { pageNumber: targetPage, attempts: 0 };
    currentPageRef.current = targetPage;
    anchorPageRef.current = targetPage;
    anchorOffsetRatioRef.current = 0;
    setCurrentPage(targetPage);
    setRestoreTick((prev) => prev + 1);
  }, [numPages]);

  useEffect(() => {
    const pendingJump = pendingJumpPageRef.current;
    if (!pendingJump) return;

    const stage = stageRef.current;
    if (!stage) return;

    const targetPage = pendingJump.pageNumber;
    const targetShell = pageShellRefs.current.get(targetPage);
    const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
    const jumpTarget = resolvePdfPageJumpTarget({
      exactPageTop: targetShell ? targetShell.offsetTop - 8 : null,
      estimatedPageTop: computeScrollTopForPageStart(targetPage),
      maxScrollable,
    });

    stage.scrollTop = jumpTarget.scrollTop;
    scrollTopRef.current = stage.scrollTop;
    anchorPageRef.current = targetPage;
    anchorOffsetRatioRef.current = 0;
    const nextScrollRatio = maxScrollable > 0
      ? normalizeRatio(stage.scrollTop / maxScrollable)
      : 0;
    const renderedWindowSettled = renderedPageNumbers.every(
      (pageNumber) => pageHeightByPageRef.current.has(pageNumber),
    );
    const jumpSettled = isPdfPageJumpSettled({
      actualScrollTop: stage.scrollTop,
      targetScrollTop: jumpTarget.scrollTop,
      hasExactTarget: jumpTarget.hasExactTarget,
      renderedWindowSettled,
    });

    if (jumpSettled) {
      pendingJumpPageRef.current = null;
      currentPageRef.current = targetPage;
      setCurrentPage(targetPage);
      persistViewerSnapshot({
        currentPage: targetPage,
        scrollTop: stage.scrollTop,
        scrollRatio: nextScrollRatio,
        anchorPage: targetPage,
        anchorOffsetRatio: 0,
      });
      return;
    }

    if (pendingJump.attempts >= PAGE_JUMP_MAX_ATTEMPTS) {
      pendingJumpPageRef.current = null;
      const anchorSnapshot = resolveViewportAnchor(stage, pageShellRefs.current, targetPage);
      const actualPage = resolveCurrentPageFromRenderedRefs(
        stage,
        pageShellRefs.current,
        anchorSnapshot.pageNumber,
      );
      currentPageRef.current = actualPage;
      anchorPageRef.current = anchorSnapshot.pageNumber;
      anchorOffsetRatioRef.current = anchorSnapshot.offsetRatio;
      setCurrentPage(actualPage);
      persistViewerSnapshot({
        currentPage: actualPage,
        scrollTop: stage.scrollTop,
        scrollRatio: nextScrollRatio,
        anchorPage: anchorSnapshot.pageNumber,
        anchorOffsetRatio: anchorSnapshot.offsetRatio,
      });
      return;
    }

    pendingJump.attempts += 1;
    persistViewerSnapshot({
      currentPage: targetPage,
      scrollTop: stage.scrollTop,
      scrollRatio: nextScrollRatio,
      anchorPage: targetPage,
      anchorOffsetRatio: 0,
    });
    const timer = window.setTimeout(() => {
      setRestoreTick((prev) => prev + 1);
    }, PAGE_JUMP_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [
    computeScrollTopForPageStart,
    layoutRevision,
    persistViewerSnapshot,
    renderedPageNumbers,
    restoreTick,
    stageRenderWidth,
    zoom,
  ]);

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

    const anchorLayoutSettled = isPdfAnchorLayoutSettled({
      anchorPage: pendingRestore.anchorPage,
      measuredPages: pageHeightByPageRef.current,
      renderedPages: renderedPageNumbers,
    });
    const reachedDesiredPosition = Math.abs(stage.scrollTop - targetTop) <= 1
      && (
        (anchorTargetTop !== null && anchorLayoutSettled)
        || (anchorTargetTop === null && desiredTop <= maxScrollable)
      );
    if (reachedDesiredPosition || pendingRestore.attempts >= 80) {
      pendingRestoreRef.current = null;
      const derivedPage = resolveCurrentPageFromRenderedRefs(
        stage,
        pageShellRefs.current,
        anchorSnapshot.pageNumber || currentPageRef.current,
      );
      anchorPageRef.current = anchorSnapshot.pageNumber;
      anchorOffsetRatioRef.current = anchorSnapshot.offsetRatio;
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
  }, [
    layoutRevision,
    numPages,
    persistViewerSnapshot,
    renderedPageNumbers,
    restoreTick,
    stageRenderWidth,
    zoom,
  ]);

  const changeZoom = useCallback((delta: number) => {
    const nextZoom = normalizeZoom(zoomRef.current + delta);
    if (nextZoom === zoomRef.current) return;

    const stage = stageRef.current;
    let restoreScheduled = false;
    if (stage && numPagesRef.current > 0) {
      const anchorSnapshot = resolveViewportAnchor(
        stage,
        pageShellRefs.current,
        currentPageRef.current,
      );
      const maxScrollable = Math.max(stage.scrollHeight - stage.clientHeight, 0);
      const nextScrollTop = Math.max(stage.scrollTop, 0);
      const nextScrollRatio = maxScrollable > 0
        ? normalizeRatio(nextScrollTop / maxScrollable)
        : 0;

      pendingJumpPageRef.current = null;
      pendingRestoreRef.current = {
        desiredScrollTop: nextScrollTop,
        desiredScrollRatio: nextScrollRatio,
        anchorPage: clamp(anchorSnapshot.pageNumber, 1, numPagesRef.current),
        anchorOffsetRatio: anchorSnapshot.offsetRatio,
        attempts: 0,
      };
      currentPageRef.current = anchorSnapshot.pageNumber;
      scrollTopRef.current = nextScrollTop;
      scrollRatioRef.current = nextScrollRatio;
      anchorPageRef.current = anchorSnapshot.pageNumber;
      anchorOffsetRatioRef.current = anchorSnapshot.offsetRatio;
      setCurrentPage(anchorSnapshot.pageNumber);
      restoreScheduled = true;
    }

    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    persistViewerSnapshot({ zoom: nextZoom });
    if (restoreScheduled) {
      setRestoreTick((prev) => prev + 1);
    }
  }, [persistViewerSnapshot]);

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
            onClick={() => changeZoom(-ZOOM_STEP)}
          />
          <span className="meta-text zoom-text">{Math.round(zoom * 100)}%</span>
          <Button
            size="small"
            icon={<IconPlus />}
            theme="borderless"
            onClick={() => changeZoom(ZOOM_STEP)}
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
