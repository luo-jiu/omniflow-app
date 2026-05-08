const VIEW_META_VIEWER_STATE_KEY = '__omniflowViewerStateV1';
const VIEW_META_VIEWER_STATE_LEGACY_KEY = '__omniflow_viewer_state_v1';
const VIEW_META_COMIC_ARCHIVE_READER_KEY = 'comicArchiveReader';
const VIEW_META_COMIC_ARCHIVE_READER_LEGACY_KEY = 'comic_archive_reader';

export interface ArchiveReaderProgress {
  anchorCardId: number | null;
  anchorOffsetRatio: number;
  scrollTop: number;
  scrollRatio: number;
  updatedAt: string;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseViewMetaObject(raw: string | null | undefined): Record<string, unknown> {
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
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseRatio(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1);
}

export function parseRemoteArchiveProgress(viewMetaRaw: string | null | undefined): ArchiveReaderProgress | null {
  const meta = parseViewMetaObject(viewMetaRaw);
  const viewerState = meta[VIEW_META_VIEWER_STATE_KEY] ?? meta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  if (!isPlainObject(viewerState)) return null;
  const readerState = viewerState[VIEW_META_COMIC_ARCHIVE_READER_KEY]
    ?? viewerState[VIEW_META_COMIC_ARCHIVE_READER_LEGACY_KEY];
  if (!isPlainObject(readerState)) return null;

  const anchorCardId = parsePositiveNumber(readerState.anchorCardId);
  const scrollTop = Number(readerState.scrollTop ?? 0);
  const currentScrollTop = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const currentScrollRatio = parseRatio(readerState.scrollRatio);
  if (!anchorCardId && currentScrollTop <= 0 && currentScrollRatio <= 0) {
    return null;
  }

  return {
    anchorCardId,
    anchorOffsetRatio: parseRatio(readerState.anchorOffsetRatio),
    scrollTop: currentScrollTop,
    scrollRatio: currentScrollRatio,
    updatedAt: String(readerState.updatedAt || ''),
  };
}

export function buildViewMetaWithArchiveProgress(
  baseMeta: Record<string, unknown>,
  progress: ArchiveReaderProgress,
): Record<string, unknown> {
  const nextMeta: Record<string, unknown> = { ...baseMeta };
  const viewerStateCandidate = nextMeta[VIEW_META_VIEWER_STATE_KEY] ?? nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  const currentViewerState = isPlainObject(viewerStateCandidate)
    ? { ...(viewerStateCandidate as Record<string, unknown>) }
    : {};
  delete currentViewerState[VIEW_META_COMIC_ARCHIVE_READER_LEGACY_KEY];
  delete nextMeta[VIEW_META_VIEWER_STATE_LEGACY_KEY];
  nextMeta[VIEW_META_VIEWER_STATE_KEY] = {
    ...currentViewerState,
    [VIEW_META_COMIC_ARCHIVE_READER_KEY]: {
      anchorCardId: progress.anchorCardId,
      anchorOffsetRatio: progress.anchorOffsetRatio,
      scrollTop: progress.scrollTop,
      scrollRatio: progress.scrollRatio,
      updatedAt: progress.updatedAt,
    },
  };
  return nextMeta;
}
