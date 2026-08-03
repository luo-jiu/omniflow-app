interface ResolvePdfPageJumpTargetOptions {
  exactPageTop: number | null;
  estimatedPageTop: number;
  maxScrollable: number;
}

interface IsPdfPageJumpSettledOptions {
  actualScrollTop: number;
  targetScrollTop: number;
  hasExactTarget: boolean;
  renderedWindowSettled: boolean;
}

interface IsPdfAnchorLayoutSettledOptions {
  anchorPage: number;
  measuredPages: { has: (pageNumber: number) => boolean };
  renderedPages: readonly number[];
}

export interface PdfViewportPageMeasurement {
  pageNumber: number;
  top: number;
  height: number;
}

export interface PdfViewportAnchor {
  pageNumber: number;
  offsetRatio: number;
}

export interface PdfPageJumpTarget {
  hasExactTarget: boolean;
  scrollTop: number;
}

function normalizeScrollTop(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

export function resolvePdfViewportAnchor(
  viewportTop: number,
  measuredPages: readonly PdfViewportPageMeasurement[],
  fallbackPage: number,
): PdfViewportAnchor {
  const normalizedViewportTop = normalizeScrollTop(viewportTop);
  const pages = measuredPages
    .filter((page) => Number.isFinite(page.top) && Number.isFinite(page.height))
    .map((page) => ({
      pageNumber: Math.max(Math.floor(page.pageNumber), 1),
      top: normalizeScrollTop(page.top),
      height: Math.max(page.height, 1),
    }))
    .sort((left, right) => left.top - right.top);

  if (pages.length === 0) {
    return {
      pageNumber: Math.max(Math.floor(fallbackPage), 1),
      offsetRatio: 0,
    };
  }

  const containingPage = pages.find((page) => (
    normalizedViewportTop >= page.top
    && normalizedViewportTop < page.top + page.height
  ));
  const anchorPage = containingPage ?? pages.reduce((closest, page) => (
    Math.abs(page.top - normalizedViewportTop) < Math.abs(closest.top - normalizedViewportTop)
      ? page
      : closest
  ));

  return {
    pageNumber: anchorPage.pageNumber,
    offsetRatio: normalizeRatio(
      (normalizedViewportTop - anchorPage.top) / anchorPage.height,
    ),
  };
}

export function resolvePdfPageJumpTarget({
  exactPageTop,
  estimatedPageTop,
  maxScrollable,
}: ResolvePdfPageJumpTargetOptions): PdfPageJumpTarget {
  const normalizedMax = normalizeScrollTop(maxScrollable);
  const hasExactTarget = exactPageTop !== null && Number.isFinite(exactPageTop);
  const requestedTop = hasExactTarget ? exactPageTop : estimatedPageTop;

  return {
    hasExactTarget,
    scrollTop: Math.min(normalizeScrollTop(requestedTop), normalizedMax),
  };
}

export function isPdfPageJumpSettled({
  actualScrollTop,
  targetScrollTop,
  hasExactTarget,
  renderedWindowSettled,
}: IsPdfPageJumpSettledOptions): boolean {
  return hasExactTarget
    && renderedWindowSettled
    && Math.abs(normalizeScrollTop(actualScrollTop) - normalizeScrollTop(targetScrollTop)) <= 1;
}

export function isPdfAnchorLayoutSettled({
  anchorPage,
  measuredPages,
  renderedPages,
}: IsPdfAnchorLayoutSettledOptions): boolean {
  if (!renderedPages.includes(anchorPage)) return false;

  return renderedPages.every((pageNumber) => (
    pageNumber > anchorPage || measuredPages.has(pageNumber)
  ));
}
