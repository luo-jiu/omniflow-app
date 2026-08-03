import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Spin, Toast, Tooltip } from '@douyinfe/semi-ui';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCrop,
  IconInfoCircle,
  IconPause,
  IconPlay,
  IconRefresh2,
  IconRotate,
  IconSearchStroked,
} from '@douyinfe/semi-icons';
import { GalleryViewerWrapper } from './style';
import {
  GALLERY_VIEWER_SESSION_ESTIMATED_BYTES,
  GALLERY_VIEWER_SESSION_SCHEMA_VERSION,
  parseGalleryViewerSessionSnapshot,
  resolveGalleryGridRestoreScrollTop,
  type GalleryViewerSessionSnapshot,
} from './gallery-viewer-session';
import ImageCropOverlay from '../image-crop-overlay';
import {
  batchGetFileLinks,
  getChildrenByNodeId,
} from '@/features/file-explorer/services/file.api';
import {
  createDefaultCropSelection,
  getDisplayedImageBounds,
  getImageRectInContainer,
  isCropBoundsUsable,
  saveCroppedImageCopy,
  type CropBounds,
  type CropSelection,
} from '../../services/image-crop.service';
import {
  mountGlobalVideoElement,
  parkGlobalVideoElement,
} from '@/features/file-viewer/services/global-video-elements';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import { isLibraryWorkspaceRoute } from '@/features/file-viewer/utils/media-route';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { useViewerSession, type ViewerSessionAdapter } from '@/features/file-viewer/session';

interface GalleryViewerProps {
  accountScope: string | null;
  contentRevision: string | null;
  folderNodeId: number | null;
  fileName?: string | null;
  libraryId: number | null;
  active?: boolean;
  reloadToken?: number;
  tabId: string;
}

interface GalleryChildNode {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  type: 'dir' | 'file' | number | string;
}

interface GalleryMediaItem {
  id: number;
  title: string;
  ext?: string;
  mimeType?: string;
  kind: 'image' | 'video';
}

interface Point {
  x: number;
  y: number;
}

interface VideoRuntimeState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

interface GalleryMetadataRow {
  label: string;
  value: string;
}

interface GalleryImagePreview {
  metadataRows: GalleryMetadataRow[];
  originalSize?: number;
  previewUrl: string;
  previewPath?: string;
}

type ViewerZoomShortcutAction = 'zoom-in' | 'zoom-out' | 'reset';
type ExifValue = string | number | number[] | undefined;

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'heic', 'heif', 'heics', 'heifs']);
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'ts',
  'flv',
  'hlv',
  'f4v',
  'mpeg',
  'mpg',
  'wmv',
  'asf',
  'movie',
  'divx',
  'mpeg4',
  'vid',
  'ogv',
  '3gp',
]);
const PREFETCH_FIRST_MEDIA_COUNT = 48;
const HEIC_PREVIEW_PREFETCH_COUNT = PREFETCH_FIRST_MEDIA_COUNT;
const KEEP_ALIVE_IMAGE_LIMIT = 12;
const GRID_BASE_CARD_WIDTH = 160;
const GRID_MIN_CARD_SCALE = 0.88;
const GRID_GAP = 14;
const GRID_HORIZONTAL_PADDING = 48;
const GRID_VERTICAL_OVERSCAN_ROWS = 3;
const IMAGE_ZOOM_MIN = 0.2;
const IMAGE_ZOOM_MAX = 6;
const TIFF_TYPE_BYTE = 1;
const TIFF_TYPE_ASCII = 2;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_TYPE_RATIONAL = 5;
const TIFF_TYPE_UNDEFINED = 7;
const TIFF_TYPE_SLONG = 9;
const TIFF_TYPE_SRATIONAL = 10;
const TIFF_TYPE_BYTES: Record<number, number> = {
  [TIFF_TYPE_BYTE]: 1,
  [TIFF_TYPE_ASCII]: 1,
  [TIFF_TYPE_SHORT]: 2,
  [TIFF_TYPE_LONG]: 4,
  [TIFF_TYPE_RATIONAL]: 8,
  [TIFF_TYPE_UNDEFINED]: 1,
  [TIFF_TYPE_SLONG]: 4,
  [TIFF_TYPE_SRATIONAL]: 8,
};
const EXIF_TAGS: Record<number, string> = {
  0x010f: '相机品牌',
  0x0110: '相机型号',
  0x0112: '方向',
  0x0131: '软件',
  0x0132: '修改时间',
  0x829a: '曝光时间',
  0x829d: '光圈',
  0x8827: 'ISO',
  0x9003: '拍摄时间',
  0x9004: '数字化时间',
  0x9209: '闪光灯',
  0x920a: '焦距',
  0xa002: '原始宽度',
  0xa003: '原始高度',
};
const EXIF_POINTER_TAG = 0x8769;
const GPS_POINTER_TAG = 0x8825;

function pushLimitedId(prev: Set<number>, id: number, limit: number): Set<number> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
  }
  next.add(id);
  while (next.size > limit) {
    const oldest = next.values().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

function normalizeExt(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

function isHiddenNodeName(name?: string, ext?: string): boolean {
  const trimmedName = String(name || '').trim();
  if (trimmedName.startsWith('.')) return true;
  return trimmedName.length === 0 && normalizeExt(ext).length > 0;
}

function isFileNode(item: GalleryChildNode): boolean {
  return String(item.type) === 'file' || Number(item.type) === 1;
}

function resolveMediaKind(item: GalleryChildNode): GalleryMediaItem['kind'] | null {
  if (!isFileNode(item) || isHiddenNodeName(item.name, item.ext)) {
    return null;
  }
  const mimeType = String(item.mimeType || '').trim().toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/') || mimeType === 'application/vnd.apple.mpegurl') return 'video';
  const ext = normalizeExt(item.ext);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function isHeicMediaItem(item?: GalleryMediaItem | null): boolean {
  if (!item || item.kind !== 'image') return false;
  const ext = normalizeExt(item.ext);
  const mimeType = String(item.mimeType || '').trim().toLowerCase();
  return ext === 'heic'
    || ext === 'heif'
    || ext === 'heics'
    || ext === 'heifs'
    || mimeType === 'image/heic'
    || mimeType === 'image/heif'
    || mimeType === 'image/heic-sequence'
    || mimeType === 'image/heif-sequence';
}

function normalizeGalleryTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return '图集';
  if (raw.toUpperCase().startsWith('GALLERY ·')) {
    const stripped = raw.replace(/^GALLERY\s*·\s*/iu, '').trim();
    return stripped || '图集';
  }
  return raw;
}

function formatTime(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  return `${next >= 10 || unitIndex === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unitIndex]}`;
}

function formatExifDate(value?: ExifValue): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  const matches = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!matches) return raw || null;
  return `${matches[1]}-${matches[2]}-${matches[3]} ${matches[4]}:${matches[5]}:${matches[6]}`;
}

function formatExifValue(value: ExifValue): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
  }
  if (Array.isArray(value)) {
    return value
      .map(item => formatExifValue(item))
      .filter((item): item is string => Boolean(item))
      .join(', ') || null;
  }
  return null;
}

function formatCoordinate(value: number): string {
  const direction = value >= 0 ? '' : '-';
  return `${direction}${Math.abs(value).toFixed(6)}°`;
}

function readAscii(dataView: DataView, offset: number, count: number): string {
  const chars: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const code = dataView.getUint8(offset + index);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  return chars.join('').trim();
}

function readExifNumber(dataView: DataView, offset: number, type: number, littleEndian: boolean): number {
  if (type === TIFF_TYPE_BYTE || type === TIFF_TYPE_UNDEFINED) return dataView.getUint8(offset);
  if (type === TIFF_TYPE_SHORT) return dataView.getUint16(offset, littleEndian);
  if (type === TIFF_TYPE_LONG) return dataView.getUint32(offset, littleEndian);
  if (type === TIFF_TYPE_SLONG) return dataView.getInt32(offset, littleEndian);
  if (type === TIFF_TYPE_RATIONAL || type === TIFF_TYPE_SRATIONAL) {
    const numerator = type === TIFF_TYPE_SRATIONAL
      ? dataView.getInt32(offset, littleEndian)
      : dataView.getUint32(offset, littleEndian);
    const denominator = type === TIFF_TYPE_SRATIONAL
      ? dataView.getInt32(offset + 4, littleEndian)
      : dataView.getUint32(offset + 4, littleEndian);
    return denominator ? numerator / denominator : 0;
  }
  return 0;
}

function readExifValue(
  dataView: DataView,
  tiffOffset: number,
  valueOffset: number,
  type: number,
  count: number,
  littleEndian: boolean,
): ExifValue {
  const bytesPerItem = TIFF_TYPE_BYTES[type];
  if (!bytesPerItem || count <= 0) return undefined;
  const byteLength = bytesPerItem * count;
  const inlineOffset = valueOffset + 8;
  const dataOffset = byteLength <= 4
    ? inlineOffset
    : tiffOffset + dataView.getUint32(valueOffset + 8, littleEndian);
  if (dataOffset < 0 || dataOffset + byteLength > dataView.byteLength) return undefined;
  if (type === TIFF_TYPE_ASCII) return readAscii(dataView, dataOffset, count);
  const values = Array.from({ length: count }, (_, index) => (
    readExifNumber(dataView, dataOffset + index * bytesPerItem, type, littleEndian)
  ));
  return count === 1 ? values[0] : values;
}

function readIfd(
  dataView: DataView,
  tiffOffset: number,
  ifdOffset: number,
  littleEndian: boolean,
): { values: Map<number, ExifValue>; exifPointer?: number; gpsPointer?: number } {
  const values = new Map<number, ExifValue>();
  let exifPointer: number | undefined;
  let gpsPointer: number | undefined;
  const absoluteOffset = tiffOffset + ifdOffset;
  if (absoluteOffset < 0 || absoluteOffset + 2 > dataView.byteLength) return { values };
  const entryCount = dataView.getUint16(absoluteOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = absoluteOffset + 2 + index * 12;
    if (entryOffset + 12 > dataView.byteLength) break;
    const tag = dataView.getUint16(entryOffset, littleEndian);
    const type = dataView.getUint16(entryOffset + 2, littleEndian);
    const count = dataView.getUint32(entryOffset + 4, littleEndian);
    const value = readExifValue(dataView, tiffOffset, entryOffset, type, count, littleEndian);
    if (tag === EXIF_POINTER_TAG && typeof value === 'number') {
      exifPointer = value;
      continue;
    }
    if (tag === GPS_POINTER_TAG && typeof value === 'number') {
      gpsPointer = value;
      continue;
    }
    values.set(tag, value);
  }
  return { values, exifPointer, gpsPointer };
}

function resolveGpsCoordinate(values: Map<number, ExifValue>, refTag: number, valueTag: number): number | null {
  const ref = formatExifValue(values.get(refTag));
  const rawValue = values.get(valueTag);
  if (!ref || !Array.isArray(rawValue) || rawValue.length < 3) return null;
  const degrees = Number(rawValue[0]);
  const minutes = Number(rawValue[1]);
  const seconds = Number(rawValue[2]);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  const sign = ref === 'S' || ref === 'W' ? -1 : 1;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function findExifTiffOffset(buffer: ArrayBuffer): number | null {
  const dataView = new DataView(buffer);
  if (dataView.byteLength < 12 || dataView.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 < dataView.byteLength) {
    if (dataView.getUint8(offset) !== 0xff) return null;
    const marker = dataView.getUint8(offset + 1);
    const segmentLength = dataView.getUint16(offset + 2);
    const segmentStart = offset + 4;
    if (marker === 0xe1 && segmentStart + 6 < dataView.byteLength) {
      const header = readAscii(dataView, segmentStart, 6);
      if (header === 'Exif') return segmentStart + 6;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function parseExifRows(buffer: ArrayBuffer): GalleryMetadataRow[] {
  const tiffOffset = findExifTiffOffset(buffer);
  if (tiffOffset === null) return [];
  const dataView = new DataView(buffer);
  const byteOrder = readAscii(dataView, tiffOffset, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return [];
  if (dataView.getUint16(tiffOffset + 2, littleEndian) !== 42) return [];
  const firstIfdOffset = dataView.getUint32(tiffOffset + 4, littleEndian);
  const primary = readIfd(dataView, tiffOffset, firstIfdOffset, littleEndian);
  const exif = primary.exifPointer ? readIfd(dataView, tiffOffset, primary.exifPointer, littleEndian) : null;
  const gps = primary.gpsPointer ? readIfd(dataView, tiffOffset, primary.gpsPointer, littleEndian) : null;
  const merged = new Map<number, ExifValue>(primary.values);
  exif?.values.forEach((value, tag) => merged.set(tag, value));
  const rows: GalleryMetadataRow[] = [];
  const captureTime = formatExifDate(merged.get(0x9003)) || formatExifDate(merged.get(0x0132));
  if (captureTime) rows.push({ label: '拍摄时间', value: captureTime });
  const latitude = gps ? resolveGpsCoordinate(gps.values, 0x0001, 0x0002) : null;
  const longitude = gps ? resolveGpsCoordinate(gps.values, 0x0003, 0x0004) : null;
  if (latitude !== null && longitude !== null) {
    rows.push({ label: '定位', value: `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}` });
  }
  Object.entries(EXIF_TAGS).forEach(([tagKey, label]) => {
    const tag = Number(tagKey);
    if (tag === 0x9003 || tag === 0x0132) return;
    const value = formatExifValue(merged.get(tag));
    if (value) rows.push({ label, value });
  });
  return rows;
}

function readImageSize(url: string): Promise<GalleryMetadataRow[]> {
  return new Promise((resolve) => {
    if (!url) {
      resolve([]);
      return;
    }
    const image = new Image();
    image.onload = () => {
      resolve([
        { label: '尺寸', value: `${image.naturalWidth} × ${image.naturalHeight}` },
      ]);
    };
    image.onerror = () => resolve([]);
    image.src = url;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveGridLayout(viewportWidth: number) {
  const contentWidth = Math.max(Math.floor(viewportWidth - GRID_HORIZONTAL_PADDING), 0);
  const minCardWidth = Math.ceil(GRID_BASE_CARD_WIDTH * GRID_MIN_CARD_SCALE);
  if (contentWidth <= 0) {
    return { cardWidth: GRID_BASE_CARD_WIDTH, columns: 1 };
  }
  const columns = Math.max(1, Math.floor((contentWidth + GRID_GAP) / (minCardWidth + GRID_GAP)));
  const computedWidth = (contentWidth - (columns - 1) * GRID_GAP) / columns;
  const cardWidth = columns === 1
    ? Math.max(1, Math.min(GRID_BASE_CARD_WIDTH, contentWidth))
    : clamp(Math.floor(computedWidth), minCardWidth, GRID_BASE_CARD_WIDTH);
  return { cardWidth, columns };
}

const GalleryViewer: React.FC<GalleryViewerProps> = ({
  accountScope,
  contentRevision,
  folderNodeId,
  fileName,
  libraryId,
  active = true,
  reloadToken = 0,
  tabId,
}) => {
  const title = useMemo(() => normalizeGalleryTitle(fileName), [fileName]);
  const [items, setItems] = useState<GalleryMediaItem[]>([]);
  const [linkMap, setLinkMap] = useState<Map<number, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [loadedThumbIds, setLoadedThumbIds] = useState<Set<number>>(() => new Set());
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotateSteps, setImageRotateSteps] = useState(0);
  const [imageOffset, setImageOffset] = useState<Point>({ x: 0, y: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isImageDragging, setIsImageDragging] = useState(false);
  const [imageDragAnchor, setImageDragAnchor] = useState<Point>({ x: 0, y: 0 });
  const [cropMode, setCropMode] = useState(false);
  const [cropBounds, setCropBounds] = useState<CropBounds | null>(null);
  const [cropSelection, setCropSelection] = useState<CropSelection | null>(null);
  const [cropApplying, setCropApplying] = useState(false);
  const [videoState, setVideoState] = useState<VideoRuntimeState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });
  const [metadataVisible, setMetadataVisible] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataRows, setMetadataRows] = useState<GalleryMetadataRow[]>([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [imagePreviewMap, setImagePreviewMap] = useState<Map<number, GalleryImagePreview>>(() => new Map());
  const [imagePreviewErrorMap, setImagePreviewErrorMap] = useState<Map<number, string>>(() => new Map());
  const [keptImageIds, setKeptImageIds] = useState<Set<number>>(() => new Set());
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridViewportHeight, setGridViewportHeight] = useState(0);
  const [gridColumnCount, setGridColumnCount] = useState(1);
  const [gridCardWidth, setGridCardWidth] = useState(GRID_BASE_CARD_WIDTH);
  const requestedLinkIdsRef = useRef<Set<number>>(new Set());
  const requestedLinkGenerationsRef = useRef<Map<number, number>>(new Map());
  const linkMapRef = useRef<Map<number, string>>(new Map());
  const imagePreviewMapRef = useRef<Map<number, GalleryImagePreview>>(new Map());
  const requestedImagePreviewIdsRef = useRef<Set<number>>(new Set());
  const requestedImagePreviewGenerationsRef = useRef<Map<number, number>>(new Map());
  const mountedRef = useRef(false);
  const previewGenerationRef = useRef(0);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const gridScrollTopRef = useRef(0);
  const gridScrollRatioRef = useRef<number | null>(null);
  const gridScrollFrameRef = useRef<number | null>(null);
  const gridRestoreFrameRef = useRef<number | null>(null);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const detailImageRef = useRef<HTMLImageElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoMountTokenRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const activeIndexRef = useRef<number | null>(activeIndex);
  const galleryLoadedRef = useRef(false);
  const gridCardWidthRef = useRef(gridCardWidth);
  const gridColumnCountRef = useRef(gridColumnCount);
  const imageOffsetRef = useRef(imageOffset);
  const imageRotateStepsRef = useRef(imageRotateSteps);
  const imageZoomRef = useRef(imageZoom);
  const itemsRef = useRef<GalleryMediaItem[]>(items);
  const pendingGridRestoreRef = useRef<GalleryViewerSessionSnapshot | null>(null);
  const pendingImageRestoreRef = useRef<{
    itemId: number;
    snapshot: GalleryViewerSessionSnapshot;
  } | null>(null);
  const pendingSessionRestoreRef = useRef<{
    resourceNodeId: number | null;
    snapshot: GalleryViewerSessionSnapshot;
  } | null>(null);
  const activeItem = activeIndex === null ? null : items[activeIndex] ?? null;
  const activeUrl = activeItem ? linkMap.get(activeItem.id) || '' : '';
  const activeImagePreview = activeItem ? imagePreviewMap.get(activeItem.id) || null : null;
  const activeDisplayUrl = isHeicMediaItem(activeItem)
    ? activeImagePreview?.previewUrl || ''
    : activeUrl;
  const activeVideoKey = activeItem?.kind === 'video'
    ? `gallery-video:${tabId}:${activeItem.id}`
    : null;
  activeRef.current = active;
  activeIndexRef.current = activeIndex;
  gridCardWidthRef.current = gridCardWidth;
  gridColumnCountRef.current = gridColumnCount;
  imageOffsetRef.current = imageOffset;
  imageRotateStepsRef.current = imageRotateSteps;
  imageZoomRef.current = imageZoom;
  itemsRef.current = items;

  const applyImageSessionSnapshot = useCallback((snapshot: GalleryViewerSessionSnapshot) => {
    const stage = imageStageRef.current;
    const viewportWidth = Math.round(stage?.clientWidth ?? 0);
    const viewportHeight = Math.round(stage?.clientHeight ?? 0);
    const nextOffset = {
      x: snapshot.imageOffsetRatioX != null && viewportWidth > 0
        ? snapshot.imageOffsetRatioX * viewportWidth
        : snapshot.imageOffsetX,
      y: snapshot.imageOffsetRatioY != null && viewportHeight > 0
        ? snapshot.imageOffsetRatioY * viewportHeight
        : snapshot.imageOffsetY,
    };
    imageZoomRef.current = snapshot.imageZoom;
    imageRotateStepsRef.current = snapshot.imageRotateSteps;
    imageOffsetRef.current = nextOffset;
    setImageZoom(snapshot.imageZoom);
    setImageRotateSteps(snapshot.imageRotateSteps);
    setImageOffset(nextOffset);
  }, []);

  const applyRestoredSnapshot = useCallback((
    snapshot: GalleryViewerSessionSnapshot,
    targetItems: GalleryMediaItem[],
  ) => {
    const restoredIndex = snapshot.activeItemId == null
      ? null
      : targetItems.findIndex(item => item.id === snapshot.activeItemId);
    const nextActiveIndex = restoredIndex != null && restoredIndex >= 0 ? restoredIndex : null;
    const nextActiveItem = nextActiveIndex == null ? null : targetItems[nextActiveIndex] ?? null;
    pendingSessionRestoreRef.current = null;
    pendingGridRestoreRef.current = snapshot;
    pendingImageRestoreRef.current = nextActiveItem?.kind === 'image'
      ? { itemId: nextActiveItem.id, snapshot }
      : null;
    gridScrollTopRef.current = snapshot.gridScrollTop;
    gridScrollRatioRef.current = snapshot.gridScrollRatio;
    setGridScrollTop(snapshot.gridScrollTop);
    setActiveIndex(nextActiveIndex);
    setImageNaturalSize({ width: 0, height: 0 });
    setIsImageDragging(false);
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
    setMetadataVisible(false);
  }, []);

  const captureGallerySnapshot = useCallback((): GalleryViewerSessionSnapshot | null => {
    if (!galleryLoadedRef.current) return null;
    const currentItems = itemsRef.current;
    const currentIndex = activeIndexRef.current;
    const currentItem = currentIndex == null ? null : currentItems[currentIndex] ?? null;
    const grid = gridScrollRef.current;
    const pendingGridRestore = pendingGridRestoreRef.current;
    const scrollTop = grid
      ? grid.scrollTop
      : pendingGridRestore?.gridScrollTop ?? gridScrollTopRef.current;
    const maxScrollable = grid ? Math.max(grid.scrollHeight - grid.clientHeight, 0) : 0;
    const gridScrollRatio = maxScrollable > 0
      ? scrollTop / maxScrollable
      : pendingGridRestore?.gridScrollRatio ?? gridScrollRatioRef.current;
    const rowStride = Math.max(gridCardWidthRef.current + GRID_GAP, 1);
    const anchorRow = Math.max(Math.floor(scrollTop / rowStride), 0);
    const anchorIndex = anchorRow * Math.max(gridColumnCountRef.current, 1);
    const anchorItem = currentItems[anchorIndex] ?? null;
    const stage = imageStageRef.current;
    const viewportWidth = Math.round(stage?.clientWidth ?? 0);
    const viewportHeight = Math.round(stage?.clientHeight ?? 0);
    return {
      activeItemId: currentItem?.id ?? null,
      gridAnchorItemId: pendingGridRestore?.gridAnchorItemId ?? anchorItem?.id ?? null,
      gridAnchorOffsetRatio: pendingGridRestore?.gridAnchorOffsetRatio
        ?? clamp((scrollTop - anchorRow * rowStride) / rowStride, 0, 1),
      gridScrollRatio: gridScrollRatio == null ? null : clamp(gridScrollRatio, 0, 1),
      gridScrollTop: Math.max(scrollTop, 0),
      imageOffsetRatioX: viewportWidth > 0 ? imageOffsetRef.current.x / viewportWidth : null,
      imageOffsetRatioY: viewportHeight > 0 ? imageOffsetRef.current.y / viewportHeight : null,
      imageOffsetX: imageOffsetRef.current.x,
      imageOffsetY: imageOffsetRef.current.y,
      imageRotateSteps: imageRotateStepsRef.current,
      imageZoom: imageZoomRef.current,
    };
  }, []);

  const restoreGallerySnapshot = useCallback((payload: GalleryViewerSessionSnapshot) => {
    const snapshot = parseGalleryViewerSessionSnapshot(payload);
    if (!snapshot) return;
    pendingSessionRestoreRef.current = { resourceNodeId: folderNodeId, snapshot };
  }, [folderNodeId]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<GalleryViewerSessionSnapshot>>(() => ({
    capture: captureGallerySnapshot,
    restore: restoreGallerySnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateCost: () => GALLERY_VIEWER_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => (activeRef.current ? ['active'] : []),
  }), [captureGallerySnapshot, restoreGallerySnapshot]);

  useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision,
    libraryId,
    nodeId: folderNodeId,
    reloadToken,
    schemaVersion: GALLERY_VIEWER_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'gallery',
  });

  const isPreviewGenerationCurrent = useCallback((generation: number) => {
    return mountedRef.current && previewGenerationRef.current === generation;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const requestedLinkIds = requestedLinkIdsRef.current;
    const requestedLinkGenerations = requestedLinkGenerationsRef.current;
    const requestedImagePreviewIds = requestedImagePreviewIdsRef.current;
    const requestedImagePreviewGenerations = requestedImagePreviewGenerationsRef.current;
    return () => {
      mountedRef.current = false;
      previewGenerationRef.current += 1;
      requestedLinkIds.clear();
      requestedLinkGenerations.clear();
      requestedImagePreviewIds.clear();
      requestedImagePreviewGenerations.clear();
    };
  }, []);

  useEffect(() => {
    previewGenerationRef.current += 1;
    requestedLinkIdsRef.current.clear();
    requestedLinkGenerationsRef.current.clear();
    requestedImagePreviewIdsRef.current.clear();
    requestedImagePreviewGenerationsRef.current.clear();
  }, [folderNodeId, libraryId, reloadToken]);

  const prepareHeicPreview = useCallback(async (
    item: GalleryMediaItem,
    sourceUrl: string,
  ): Promise<GalleryImagePreview | null> => {
    if (!libraryId || !isHeicMediaItem(item) || !sourceUrl) return null;
    const existing = imagePreviewMapRef.current.get(item.id);
    if (existing) return existing;
    if (requestedImagePreviewIdsRef.current.has(item.id)) return null;
    const api = window.electronAPI?.prepareImagePreview;
    if (!api) return null;

    requestedImagePreviewIdsRef.current.add(item.id);
    const requestGeneration = previewGenerationRef.current;
    requestedImagePreviewGenerationsRef.current.set(item.id, requestGeneration);
    try {
      const result = await api({
        nodeId: item.id,
        libraryId,
        url: sourceUrl,
        fileName: item.title,
        ext: item.ext,
        mimeType: item.mimeType,
      });
      const nextPreviewUrl = result?.previewUrl || result?.previewDataUrl || '';
      if (!result?.ok || !nextPreviewUrl) {
        throw new Error(result?.error || '生成 HEIC 预览失败');
      }
      if (!isPreviewGenerationCurrent(requestGeneration)) return null;
      const preview: GalleryImagePreview = {
        metadataRows: Array.isArray(result.metadataRows) ? result.metadataRows : [],
        originalSize: result.originalSize,
        previewUrl: nextPreviewUrl,
        previewPath: result.previewPath,
      };
      setImagePreviewMap((prev) => {
        const next = new Map(prev);
        next.set(item.id, preview);
        imagePreviewMapRef.current = next;
        return next;
      });
      setImagePreviewErrorMap((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
      return preview;
    } catch (previewError: any) {
      if (!isPreviewGenerationCurrent(requestGeneration)) return null;
      const message = previewError?.message || '生成 HEIC 预览失败';
      setImagePreviewErrorMap((prev) => {
        const next = new Map(prev);
        next.set(item.id, message);
        return next;
      });
      runtimeLogger.warn('生成 HEIC 预览失败:', previewError);
      return null;
    } finally {
      if (requestedImagePreviewGenerationsRef.current.get(item.id) === requestGeneration) {
        requestedImagePreviewGenerationsRef.current.delete(item.id);
        requestedImagePreviewIdsRef.current.delete(item.id);
      }
    }
  }, [isPreviewGenerationCurrent, libraryId]);

  const ensureLinksFor = useCallback(async (
    targetItems: GalleryMediaItem[],
    options?: { prepareHeicPreview?: boolean },
  ) => {
    if (!libraryId || targetItems.length === 0) return;
    const requestGeneration = previewGenerationRef.current;
    const previewLinks = new Map<number, string>();
    targetItems.forEach((item) => {
      const existingUrl = linkMapRef.current.get(item.id);
      if (existingUrl) previewLinks.set(item.id, existingUrl);
    });
    const missingIds = targetItems
      .map(item => item.id)
      .filter((id) => {
        if (linkMapRef.current.has(id) || requestedLinkIdsRef.current.has(id)) return false;
        requestedLinkIdsRef.current.add(id);
        requestedLinkGenerationsRef.current.set(id, requestGeneration);
        return true;
      });
    if (missingIds.length > 0) {
      try {
        const nextLinks = await batchGetFileLinks({
          libraryId,
          nodeIds: missingIds,
          expiry: 240,
        });
        if (!isPreviewGenerationCurrent(requestGeneration)) return;
        const returnedIds = new Set<number>();
        setLinkMap((prev) => {
          const next = new Map(prev);
          nextLinks.forEach((url, nodeId) => {
            returnedIds.add(nodeId);
            next.set(nodeId, url);
            previewLinks.set(nodeId, url);
          });
          linkMapRef.current = next;
          return next;
        });
        missingIds
          .filter(id => !returnedIds.has(id))
          .forEach((id) => {
            if (requestedLinkGenerationsRef.current.get(id) === requestGeneration) {
              requestedLinkGenerationsRef.current.delete(id);
              requestedLinkIdsRef.current.delete(id);
            }
          });
      } catch (loadError) {
        missingIds.forEach((id) => {
          if (requestedLinkGenerationsRef.current.get(id) === requestGeneration) {
            requestedLinkGenerationsRef.current.delete(id);
            requestedLinkIdsRef.current.delete(id);
          }
        });
        runtimeLogger.error('加载图集媒体链接失败:', loadError);
      }
    }
    if (options?.prepareHeicPreview) {
      const heicItems = targetItems
        .filter(item => isHeicMediaItem(item))
        .filter(item => !imagePreviewMapRef.current.has(item.id))
        .slice(0, HEIC_PREVIEW_PREFETCH_COUNT);
      void (async () => {
        for (const item of heicItems) {
          if (!isPreviewGenerationCurrent(requestGeneration)) return;
          const sourceUrl = previewLinks.get(item.id) || linkMapRef.current.get(item.id);
          if (sourceUrl) {
            await prepareHeicPreview(item, sourceUrl);
          }
        }
      })();
    }
  }, [isPreviewGenerationCurrent, libraryId, prepareHeicPreview]);

  useEffect(() => {
    let cancelled = false;
    async function loadGallery() {
      galleryLoadedRef.current = false;
      if (!folderNodeId || !libraryId) {
        setItems([]);
        setLoading(false);
        setError('图集目录参数异常');
        return;
      }
      setLoading(true);
      setError(null);
      setActiveIndex(null);
      pendingGridRestoreRef.current = null;
      pendingImageRestoreRef.current = null;
      const emptyLinks = new Map<number, string>();
      linkMapRef.current = emptyLinks;
      setLinkMap(emptyLinks);
      setLoadedThumbIds(new Set());
      gridScrollTopRef.current = 0;
      gridScrollRatioRef.current = null;
      setGridScrollTop(0);
      requestedLinkIdsRef.current.clear();
      requestedLinkGenerationsRef.current.clear();
      imagePreviewMapRef.current = new Map();
      setImagePreviewMap(new Map());
      setImagePreviewErrorMap(new Map());
      requestedImagePreviewIdsRef.current.clear();
      requestedImagePreviewGenerationsRef.current.clear();
      setKeptImageIds(new Set());
      setImageZoom(1);
      setImageRotateSteps(0);
      setImageOffset({ x: 0, y: 0 });
      setImageNaturalSize({ width: 0, height: 0 });
      setIsImageDragging(false);
      setCropMode(false);
      setCropBounds(null);
      setCropSelection(null);
      setMetadataVisible(false);
      try {
        const children = await getChildrenByNodeId(folderNodeId, libraryId) as GalleryChildNode[];
        if (cancelled) return;
        const nextItems = children
          .reduce<GalleryMediaItem[]>((acc, child) => {
            const kind = resolveMediaKind(child);
            const id = Number(child.id);
            if (!kind || !Number.isFinite(id) || id <= 0) return acc;
            acc.push({
              id: Number(child.id),
              title: buildFileFullName(String(child.name || ''), child.ext) || `media-${child.id}`,
              ext: child.ext,
              mimeType: child.mimeType,
              kind,
            });
            return acc;
          }, []);
        itemsRef.current = nextItems;
        setItems(nextItems);
        galleryLoadedRef.current = true;
        const pendingRestore = pendingSessionRestoreRef.current;
        if (pendingRestore?.resourceNodeId === folderNodeId) {
          applyRestoredSnapshot(pendingRestore.snapshot, nextItems);
        } else {
          pendingSessionRestoreRef.current = null;
        }
        void ensureLinksFor(nextItems.slice(0, PREFETCH_FIRST_MEDIA_COUNT), { prepareHeicPreview: true });
      } catch (loadError) {
        if (cancelled) return;
        runtimeLogger.error('加载图集失败:', loadError);
        setError('图集加载失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadGallery();
    return () => {
      cancelled = true;
    };
  }, [applyRestoredSnapshot, ensureLinksFor, folderNodeId, libraryId, reloadToken]);

  useEffect(() => {
    const pendingImageRestore = pendingImageRestoreRef.current;
    if (
      pendingImageRestore
      && activeItem?.kind === 'image'
      && pendingImageRestore.itemId === activeItem.id
    ) {
      pendingImageRestoreRef.current = null;
      applyImageSessionSnapshot(pendingImageRestore.snapshot);
      setImageNaturalSize({ width: 0, height: 0 });
      setIsImageDragging(false);
      setCropMode(false);
      setCropBounds(null);
      setCropSelection(null);
      return;
    }
    setImageZoom(1);
    setImageRotateSteps(0);
    setImageOffset({ x: 0, y: 0 });
    setImageNaturalSize({ width: 0, height: 0 });
    setIsImageDragging(false);
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
  }, [activeItem?.id, activeItem?.kind, applyImageSessionSnapshot]);

  useEffect(() => {
    if (!activeItem) return;
    void ensureLinksFor([activeItem]);
    const start = Math.max((activeIndex ?? 0) - 2, 0);
    const end = Math.min((activeIndex ?? 0) + 3, items.length);
    void ensureLinksFor(items.slice(start, end), { prepareHeicPreview: true });
  }, [activeIndex, activeItem, ensureLinksFor, items]);

  useEffect(() => {
    if (!activeItem || !activeUrl || !isHeicMediaItem(activeItem)) return;
    void prepareHeicPreview(activeItem, activeUrl);
  }, [activeItem, activeUrl, prepareHeicPreview]);

  useEffect(() => {
    if (items.length === 0 || linkMap.size === 0) return;
    const candidates = items
      .slice(0, PREFETCH_FIRST_MEDIA_COUNT)
      .filter(item => isHeicMediaItem(item))
      .filter(item => Boolean(linkMap.get(item.id)))
      .filter(item => !imagePreviewMap.has(item.id))
      .filter(item => !requestedImagePreviewIdsRef.current.has(item.id));
    if (candidates.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const item of candidates) {
        if (cancelled) return;
        if (imagePreviewMapRef.current.has(item.id)) continue;
        const sourceUrl = linkMapRef.current.get(item.id) || linkMap.get(item.id) || '';
        if (!sourceUrl) continue;
        await prepareHeicPreview(item, sourceUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imagePreviewMap, items, linkMap, prepareHeicPreview]);

  useEffect(() => {
    if (!activeItem || activeItem.kind !== 'image' || !activeDisplayUrl) return;
    setKeptImageIds((prev) => {
      return pushLimitedId(prev, activeItem.id, KEEP_ALIVE_IMAGE_LIMIT);
    });
  }, [activeDisplayUrl, activeItem]);

  useEffect(() => {
    if (active) return;
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
    setIsImageDragging(false);
  }, [active]);

  useEffect(() => {
    if (activeIndex !== null) return;
    const grid = gridScrollRef.current;
    if (!grid) return;
    const layout = resolveGridLayout(grid.clientWidth);
    const viewportHeight = grid.clientHeight;
    gridCardWidthRef.current = layout.cardWidth;
    gridColumnCountRef.current = layout.columns;
    if (
      gridCardWidth !== layout.cardWidth
      || gridColumnCount !== layout.columns
      || gridViewportHeight !== viewportHeight
    ) {
      setGridViewportHeight(viewportHeight);
      setGridColumnCount(layout.columns);
      setGridCardWidth(layout.cardWidth);
      return;
    }
    const pendingRestore = pendingGridRestoreRef.current;
    const fallbackScrollTop = gridScrollTopRef.current;
    if (gridRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(gridRestoreFrameRef.current);
    }
    gridRestoreFrameRef.current = window.requestAnimationFrame(() => {
      gridRestoreFrameRef.current = null;
      let targetScrollTop = fallbackScrollTop;
      if (pendingRestore) {
        targetScrollTop = resolveGalleryGridRestoreScrollTop({
          cardWidth: layout.cardWidth,
          columns: layout.columns,
          gap: GRID_GAP,
          itemIds: items.map(item => item.id),
          maxScrollable: Math.max(grid.scrollHeight - grid.clientHeight, 0),
          snapshot: pendingRestore,
        });
        pendingGridRestoreRef.current = null;
      }
      const maxScrollable = Math.max(grid.scrollHeight - grid.clientHeight, 0);
      const nextScrollTop = clamp(targetScrollTop, 0, maxScrollable);
      grid.scrollTop = nextScrollTop;
      gridScrollTopRef.current = nextScrollTop;
      gridScrollRatioRef.current = maxScrollable > 0 ? nextScrollTop / maxScrollable : null;
      setGridScrollTop(nextScrollTop);
    });
  }, [activeIndex, gridCardWidth, gridColumnCount, gridViewportHeight, items]);

  useEffect(() => {
    const grid = gridScrollRef.current;
    if (!grid || activeIndex !== null) return undefined;
    const updateMetrics = () => {
      const { cardWidth, columns } = resolveGridLayout(grid.clientWidth);
      gridCardWidthRef.current = cardWidth;
      gridColumnCountRef.current = columns;
      setGridViewportHeight(grid.clientHeight);
      setGridColumnCount(columns);
      setGridCardWidth(cardWidth);
    };
    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(grid);
    return () => {
      observer.disconnect();
    };
  }, [activeIndex, items.length]);

  useEffect(() => () => {
    if (gridScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(gridScrollFrameRef.current);
      gridScrollFrameRef.current = null;
    }
    if (gridRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(gridRestoreFrameRef.current);
      gridRestoreFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!metadataVisible || !activeItem) return;
    let cancelled = false;
    const metadataItem = activeItem;
    async function loadMetadata() {
      setMetadataLoading(true);
      setMetadataError(null);
      const baseRows: GalleryMetadataRow[] = [
        { label: '类型', value: metadataItem.kind === 'image' ? '图片' : '视频' },
        { label: '节点 ID', value: String(metadataItem.id) },
      ];
      if (metadataItem.ext) baseRows.push({ label: '扩展名', value: normalizeExt(metadataItem.ext).toUpperCase() });
      if (metadataItem.mimeType) baseRows.push({ label: 'MIME', value: metadataItem.mimeType });

      try {
        if (metadataItem.kind === 'video') {
          const video = videoRef.current;
          const rows = [...baseRows];
          if (video && video.videoWidth > 0 && video.videoHeight > 0) {
            rows.push({ label: '尺寸', value: `${video.videoWidth} × ${video.videoHeight}` });
          }
          if (videoState.duration > 0) {
            rows.push({ label: '时长', value: formatTime(videoState.duration) });
          }
          if (!cancelled) {
            setMetadataRows(rows);
            setMetadataError(null);
          }
          return;
        }

        if (isHeicMediaItem(metadataItem)) {
          const preview = activeImagePreview || await prepareHeicPreview(metadataItem, activeUrl);
          const rows = [...baseRows];
          if (preview?.originalSize) rows.push({ label: '文件大小', value: formatBytes(preview.originalSize) });
          rows.push(...(preview?.metadataRows ?? []));
          if (!cancelled) {
            setMetadataRows(rows);
            setMetadataError(preview?.metadataRows?.length ? null : (imagePreviewErrorMap.get(metadataItem.id) || '未发现可读 HEIC 信息'));
          }
          return;
        }

        const [sizeRows, response] = await Promise.all([
          readImageSize(activeDisplayUrl),
          activeUrl ? fetch(activeUrl) : Promise.resolve(null),
        ]);
        const rows = [...baseRows, ...sizeRows];
        let exifRows: GalleryMetadataRow[] = [];
        if (response) {
          const contentLength = Number(response.headers.get('content-length'));
          if (Number.isFinite(contentLength) && contentLength > 0) {
            rows.push({ label: '文件大小', value: formatBytes(contentLength) });
          }
          const buffer = await response.arrayBuffer();
          if (!Number.isFinite(contentLength) || contentLength <= 0) {
            rows.push({ label: '文件大小', value: formatBytes(buffer.byteLength) });
          }
          exifRows = parseExifRows(buffer);
        }
        if (!cancelled) {
          setMetadataRows([...rows, ...exifRows]);
          setMetadataError(exifRows.length === 0 ? '未发现可读 EXIF 信息' : null);
        }
      } catch (loadError) {
        runtimeLogger.warn('读取图集媒体详情失败:', loadError);
        if (!cancelled) {
          setMetadataRows(baseRows);
          setMetadataError('无法读取图片底层信息');
        }
      } finally {
        if (!cancelled) {
          setMetadataLoading(false);
        }
      }
    }
    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [activeDisplayUrl, activeImagePreview, activeItem, activeUrl, imagePreviewErrorMap, metadataVisible, prepareHeicPreview, videoState.duration]);

  useEffect(() => {
    if (!activeVideoKey || !activeItem || !activeUrl || !libraryId) {
      videoRef.current = null;
      return undefined;
    }
    const host = videoHostRef.current;
    if (!host) return undefined;

    const mounted = mountGlobalVideoElement(activeVideoKey, host);
    videoMountTokenRef.current = mounted.mountToken;
    videoRef.current = mounted.element;
    const video = mounted.element;
    if (video.src !== activeUrl) {
      video.src = activeUrl;
      video.load();
    }
    floatingVideoService.bindInline({
      key: activeVideoKey,
      libraryId,
      tabId,
      nodeId: activeItem.id,
      fileName: activeItem.title,
      forceInline: true,
    });

    const sync = () => {
      setVideoState({
        isPlaying: !video.paused && !video.ended,
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    video.addEventListener('timeupdate', sync);
    video.addEventListener('loadedmetadata', sync);
    sync();

    return () => {
      video.removeEventListener('play', sync);
      video.removeEventListener('pause', sync);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('loadedmetadata', sync);
      const mountToken = videoMountTokenRef.current ?? mounted.mountToken;
      if (isLibraryWorkspaceRoute(window.location.hash)) {
        const floatingState = floatingVideoService.getState();
        const isHostedOutsideInline = floatingState.key === activeVideoKey
          && floatingState.hostMode !== 'inline';
        if (!isHostedOutsideInline) {
          parkGlobalVideoElement(activeVideoKey, mountToken);
        }
        return;
      }
      floatingVideoService.handoffToFloating(activeVideoKey, mountToken);
    };
  }, [activeItem, activeUrl, activeVideoKey, libraryId, tabId]);

  const releaseCurrentVideoIfNeeded = useCallback((nextItemId?: number) => {
    if (activeItem?.kind === 'video' && activeItem.id !== nextItemId) {
      floatingVideoService.releaseForTab(tabId);
      setVideoState({ isPlaying: false, currentTime: 0, duration: 0 });
    }
  }, [activeItem, tabId]);

  const openDetail = useCallback((index: number) => {
    const nextItem = items[index];
    if (!nextItem) return;
    if (gridScrollRef.current) {
      const grid = gridScrollRef.current;
      gridScrollTopRef.current = grid.scrollTop;
      const maxScrollable = Math.max(grid.scrollHeight - grid.clientHeight, 0);
      gridScrollRatioRef.current = maxScrollable > 0 ? grid.scrollTop / maxScrollable : null;
    }
    releaseCurrentVideoIfNeeded(nextItem.id);
    setActiveIndex(index);
    void ensureLinksFor([nextItem], { prepareHeicPreview: true });
  }, [ensureLinksFor, items, releaseCurrentVideoIfNeeded]);

  const closeDetail = useCallback(() => {
    releaseCurrentVideoIfNeeded();
    setActiveIndex(null);
  }, [releaseCurrentVideoIfNeeded]);

  const moveDetail = useCallback((delta: number) => {
    if (cropMode || cropApplying) return;
    if (activeIndex === null || items.length === 0) return;
    const nextIndex = (activeIndex + delta + items.length) % items.length;
    openDetail(nextIndex);
  }, [activeIndex, cropApplying, cropMode, items.length, openDetail]);

  const resetImageView = useCallback(() => {
    setImageZoom(1);
    setImageRotateSteps(0);
    setImageOffset({ x: 0, y: 0 });
    setIsImageDragging(false);
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
  }, []);

  const applyImageZoomShortcut = useCallback((action: ViewerZoomShortcutAction) => {
    if (!active || activeIndex === null || activeItem?.kind !== 'image' || cropMode) return;
    if (action === 'zoom-in') {
      setImageZoom(prev => clamp(prev * 1.15, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX));
      return;
    }
    if (action === 'zoom-out') {
      setImageZoom(prev => clamp(prev / 1.15, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX));
      return;
    }
    resetImageView();
  }, [active, activeIndex, activeItem?.kind, cropMode, resetImageView]);

  useEffect(() => {
    if (!active || activeIndex === null) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      if (cropMode) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!cropApplying) {
            setCropMode(false);
            setCropBounds(null);
            setCropSelection(null);
          }
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && activeItem?.kind === 'image') {
        const code = event.code;
        const key = event.key;
        const isPlus = key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd';
        const isMinus = key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract';
        const isReset = key === '0' || code === 'Digit0' || code === 'Numpad0';
        if (isPlus || isMinus || isReset) {
          event.preventDefault();
          event.stopPropagation();
          applyImageZoomShortcut(isPlus ? 'zoom-in' : isMinus ? 'zoom-out' : 'reset');
          return;
        }
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveDetail(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveDetail(1);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetail();
      }
      if ((event.key === ' ' || event.key.toLowerCase() === 'k') && activeItem?.kind === 'video') {
        event.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
          void video.play().catch(error => runtimeLogger.error('图集视频播放失败:', error));
        } else {
          video.pause();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, activeIndex, activeItem?.kind, applyImageZoomShortcut, closeDetail, cropApplying, cropMode, moveDetail]);

  const toggleVideoPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(error => runtimeLogger.error('图集视频播放失败:', error));
    } else {
      video.pause();
    }
  }, []);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    video.currentTime = next;
    setVideoState(prev => ({ ...prev, currentTime: next }));
  }, []);

  const handleImageWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (activeItem?.kind !== 'image') return;
    event.preventDefault();
    if (cropMode) return;
    const direction = event.deltaY > 0 ? -1 : 1;
    setImageZoom(prev => clamp(prev + direction * prev * 0.1, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX));
  }, [activeItem?.kind, cropMode]);

  const handleImageMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (activeItem?.kind !== 'image' || cropMode || event.button !== 0) return;
    setIsImageDragging(true);
    setImageDragAnchor({
      x: event.clientX - imageOffset.x,
      y: event.clientY - imageOffset.y,
    });
  }, [activeItem?.kind, cropMode, imageOffset]);

  const handleImageMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (cropMode || !isImageDragging) return;
    setImageOffset({
      x: event.clientX - imageDragAnchor.x,
      y: event.clientY - imageDragAnchor.y,
    });
  }, [cropMode, imageDragAnchor, isImageDragging]);

  useEffect(() => {
    const off = window.electronAPI?.onViewerZoomShortcut?.(({ action }) => {
      applyImageZoomShortcut(action);
    });
    return () => {
      off?.();
    };
  }, [applyImageZoomShortcut]);

  const enterCropMode = useCallback(() => {
    if (!activeItem || activeItem.kind !== 'image' || !activeDisplayUrl) {
      Toast.warning('图片尚未加载完成');
      return;
    }
    if (imageRotateSteps !== 0) {
      Toast.warning('请先重置旋转后再裁剪');
      return;
    }
    if (imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) {
      Toast.warning('图片尚未加载完成');
      return;
    }
    const nextBounds = getDisplayedImageBounds(imageStageRef.current, detailImageRef.current);
    if (!isCropBoundsUsable(nextBounds)) {
      Toast.warning('当前可裁剪区域过小');
      return;
    }
    setIsImageDragging(false);
    setCropBounds(nextBounds);
    setCropSelection(createDefaultCropSelection(nextBounds));
    setCropMode(true);
  }, [activeDisplayUrl, activeItem, imageNaturalSize.height, imageNaturalSize.width, imageRotateSteps]);

  const cancelCropMode = useCallback(() => {
    if (cropApplying) return;
    setCropMode(false);
    setCropBounds(null);
    setCropSelection(null);
  }, [cropApplying]);

  const applyCrop = useCallback(async () => {
    if (!activeItem || activeItem.kind !== 'image' || !activeDisplayUrl || !cropSelection || !folderNodeId || !libraryId) {
      return;
    }
    const imageRect = getImageRectInContainer(imageStageRef.current, detailImageRef.current);
    if (!imageRect) {
      Toast.warning('无法读取图片位置');
      return;
    }

    setCropApplying(true);
    try {
      const children = await getChildrenByNodeId(folderNodeId, libraryId) as GalleryChildNode[];
      const existingNames = children
        .map(child => buildFileFullName(String(child.name || ''), child.ext))
        .filter(Boolean);
      const created = await saveCroppedImageCopy({
        beforeNodeId: activeItem.id,
        existingNames,
        imageRect,
        libraryId,
        naturalSize: imageNaturalSize,
        parentId: folderNodeId,
        selection: cropSelection,
        sourceFileName: activeItem.title,
        sourceUrl: activeDisplayUrl,
      }) as Record<string, unknown>;
      const createdId = Number(created?.id);
      if (Number.isFinite(createdId) && createdId > 0 && activeIndex !== null) {
        const createdItem: GalleryMediaItem = {
          id: createdId,
          title: buildFileFullName(String(created.name || ''), created.ext as string | undefined) || `${activeItem.title} 副本`,
          ext: created.ext as string | undefined,
          mimeType: created.mimeType as string | undefined,
          kind: 'image',
        };
        setItems((prev) => {
          const insertIndex = prev.findIndex(item => item.id === activeItem.id);
          if (insertIndex < 0 || prev.some(item => item.id === createdId)) return prev;
          const next = [...prev];
          next.splice(insertIndex, 0, createdItem);
          return next;
        });
        setActiveIndex(index => (index === null ? index : index + 1));
        void ensureLinksFor([createdItem]);
      }
      Toast.success('已保存裁剪副本');
      setCropMode(false);
      setCropBounds(null);
      setCropSelection(null);
    } catch (error: any) {
      runtimeLogger.error('图集保存裁剪图片失败:', error);
      Toast.error(error?.message || '保存裁剪副本失败');
    } finally {
      setCropApplying(false);
    }
  }, [activeDisplayUrl, activeIndex, activeItem, cropSelection, ensureLinksFor, folderNodeId, imageNaturalSize, libraryId]);

  const getImageDisplayUrl = useCallback((item: GalleryMediaItem): string => {
    if (item.kind !== 'image') return '';
    if (isHeicMediaItem(item)) {
      return imagePreviewMap.get(item.id)?.previewUrl || '';
    }
    return linkMap.get(item.id) || '';
  }, [imagePreviewMap, linkMap]);

  const gridWindow = useMemo(() => {
    const rowStride = gridCardWidth + GRID_GAP;
    const totalRows = Math.ceil(items.length / Math.max(gridColumnCount, 1));
    const firstVisibleRow = Math.max(0, Math.floor(gridScrollTop / Math.max(rowStride, 1)) - GRID_VERTICAL_OVERSCAN_ROWS);
    const visibleRowCount = Math.max(
      GRID_VERTICAL_OVERSCAN_ROWS * 2 + 1,
      Math.ceil(gridViewportHeight / Math.max(rowStride, 1)) + GRID_VERTICAL_OVERSCAN_ROWS * 2,
    );
    const lastVisibleRow = Math.min(totalRows, firstVisibleRow + visibleRowCount);
    const startIndex = firstVisibleRow * gridColumnCount;
    const endIndex = Math.min(items.length, lastVisibleRow * gridColumnCount);
    return {
      endIndex,
      offsetTop: firstVisibleRow * rowStride,
      startIndex,
      totalHeight: totalRows > 0 ? totalRows * gridCardWidth + Math.max(totalRows - 1, 0) * GRID_GAP : 0,
    };
  }, [gridCardWidth, gridColumnCount, gridScrollTop, gridViewportHeight, items]);

  const gridWindowItems = useMemo(() => (
    items.slice(gridWindow.startIndex, gridWindow.endIndex)
  ), [gridWindow.endIndex, gridWindow.startIndex, items]);

  useEffect(() => {
    if (gridWindowItems.length === 0) return;
    void ensureLinksFor(gridWindowItems, { prepareHeicPreview: true });
  }, [ensureLinksFor, gridWindowItems]);

  const renderImageKeepAlive = () => {
    if (keptImageIds.size === 0) return null;
    const keepAliveImages = items
      .filter(item => item.kind === 'image' && keptImageIds.has(item.id))
      .map((item) => {
        const url = getImageDisplayUrl(item);
        return url ? { item, url } : null;
      })
      .filter((entry): entry is { item: GalleryMediaItem; url: string } => Boolean(entry));
    if (keepAliveImages.length === 0) return null;
    return (
      <div className="gallery-image-keepalive" aria-hidden="true">
        {keepAliveImages.map(({ item, url }) => (
          <img key={item.id} src={url} alt="" draggable={false} />
        ))}
      </div>
    );
  };

  const renderGrid = () => (
    <div className="gallery-grid-wrap">
      <div className="gallery-header">
        <div className="gallery-title-block">
          <span className="gallery-kicker">GALLERY</span>
          <h2>{title}</h2>
        </div>
        <div className="gallery-counts">
          <span>{items.filter(item => item.kind === 'image').length} 图片</span>
          <span>{items.filter(item => item.kind === 'video').length} 视频</span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="gallery-empty">当前图集没有可展示的图片或视频</div>
      ) : (
        <div
          ref={gridScrollRef}
          className="gallery-grid"
          onScroll={(event) => {
            const grid = event.currentTarget;
            const nextScrollTop = grid.scrollTop;
            gridScrollTopRef.current = nextScrollTop;
            const maxScrollable = Math.max(grid.scrollHeight - grid.clientHeight, 0);
            gridScrollRatioRef.current = maxScrollable > 0 ? nextScrollTop / maxScrollable : null;
            if (gridScrollFrameRef.current !== null) return;
            gridScrollFrameRef.current = window.requestAnimationFrame(() => {
              gridScrollFrameRef.current = null;
              setGridScrollTop(gridScrollTopRef.current);
            });
          }}
        >
          <div className="gallery-grid-virtual-space" style={{ height: gridWindow.totalHeight }}>
            <div
              className="gallery-grid-content"
              style={{
                gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, ${gridCardWidth}px))`,
                transform: `translateY(${gridWindow.offsetTop}px)`,
              }}
            >
              {gridWindowItems.map((item, windowIndex) => {
                const index = gridWindow.startIndex + windowIndex;
                const sourceUrl = linkMap.get(item.id) || '';
                const url = getImageDisplayUrl(item);
                const isLoaded = loadedThumbIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="gallery-card"
                    onClick={() => openDetail(index)}
                    onMouseEnter={() => {
                      void ensureLinksFor([item], { prepareHeicPreview: true });
                      if (sourceUrl && isHeicMediaItem(item)) {
                        void prepareHeicPreview(item, sourceUrl);
                      }
                    }}
                    title={item.title}
                  >
                    <span className={`gallery-thumb ${item.kind} ${isLoaded ? 'loaded' : ''}`}>
                      {item.kind === 'image' && url ? (
                        <img
                          src={url}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          onLoad={() => {
                            setLoadedThumbIds((prev) => {
                              const next = new Set(prev);
                              next.add(item.id);
                              return next;
                            });
                          }}
                        />
                      ) : item.kind === 'video' ? (
                        <span className="video-thumb-mark">VIDEO</span>
                      ) : (
                        <span className="video-thumb-mark">HEIC</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderImageDetail = () => (
    <div
      ref={imageStageRef}
      className={`gallery-detail-stage image ${isImageDragging ? 'dragging' : ''}`}
      onWheel={handleImageWheel}
      onMouseDown={handleImageMouseDown}
      onMouseMove={handleImageMouseMove}
      onMouseUp={() => setIsImageDragging(false)}
      onMouseLeave={() => setIsImageDragging(false)}
    >
      {activeDisplayUrl ? (
        <img
          ref={detailImageRef}
          className="gallery-detail-image"
          src={activeDisplayUrl}
          alt={activeItem?.title || title}
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            setImageNaturalSize({
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          }}
          style={{
            transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom}) rotate(${imageRotateSteps * 90}deg)`,
          }}
        />
      ) : (
        <Spin />
      )}
      {cropMode ? (
        <ImageCropOverlay
          applying={cropApplying}
          bounds={cropBounds}
          selection={cropSelection}
          onApply={applyCrop}
          onCancel={cancelCropMode}
          onSelectionChange={setCropSelection}
        />
      ) : null}
    </div>
  );

  const renderVideoDetail = () => (
    <div className="gallery-detail-stage video">
      <div ref={videoHostRef} className="gallery-video-host" />
      {!activeUrl ? <Spin /> : null}
      <div className="gallery-video-controls">
        <Button
          theme="borderless"
          type="tertiary"
          icon={videoState.isPlaying ? <IconPause /> : <IconPlay />}
          onClick={toggleVideoPlay}
          aria-label={videoState.isPlaying ? '暂停' : '播放'}
        />
        <span className="video-time">{formatTime(videoState.currentTime)}</span>
        <input
          aria-label="播放进度"
          type="range"
          min={0}
          max={Math.max(videoState.duration, 0)}
          step={0.1}
          value={Math.min(videoState.currentTime, videoState.duration || 0)}
          onChange={handleSeek}
        />
        <span className="video-time">{formatTime(videoState.duration)}</span>
      </div>
    </div>
  );

  const renderMetadataModal = () => (
    <Modal
      title="媒体详情"
      visible={metadataVisible}
      onCancel={() => setMetadataVisible(false)}
      footer={null}
      width={520}
      className="gallery-metadata-modal"
      maskClosable
      getPopupContainer={() => document.querySelector('.gallery-detail') as HTMLElement || document.body}
    >
      {metadataLoading ? (
        <div className="gallery-metadata-loading">
          <Spin tip="正在读取详情..." />
        </div>
      ) : (
        <div className="gallery-metadata-body">
          {metadataRows.length > 0 ? (
            <dl className="gallery-metadata-list">
              {metadataRows.map(row => (
                <React.Fragment key={`${row.label}:${row.value}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}
          {metadataError ? <div className="gallery-metadata-note">{metadataError}</div> : null}
        </div>
      )}
    </Modal>
  );

  const renderDetail = () => {
    if (!activeItem || activeIndex === null) return null;
    return (
      <div className="gallery-detail">
        <div className="gallery-detail-topbar">
          <Button theme="borderless" type="tertiary" icon={<IconChevronLeft />} onClick={closeDetail} aria-label="返回图集" />
          <div className="gallery-detail-title">
            <small>{activeIndex + 1} / {items.length}</small>
          </div>
          <div className="gallery-image-tools">
            <Tooltip content="媒体详情" position="bottom">
              <Button
                className="gallery-tool-button"
                theme="borderless"
                type="tertiary"
                icon={<IconInfoCircle />}
                onClick={() => setMetadataVisible(true)}
                aria-label="媒体详情"
              />
            </Tooltip>
            {activeItem.kind === 'image' ? (
              <>
                <Tooltip content="重置视图" position="bottom">
                  <Button
                    className="gallery-tool-button"
                    theme="borderless"
                    type="tertiary"
                    icon={<IconRefresh2 />}
                    onClick={resetImageView}
                    aria-label="重置视图"
                  />
                </Tooltip>
                <Tooltip content="旋转 90°" position="bottom">
                  <Button
                    className="gallery-tool-button"
                    theme="borderless"
                    type="tertiary"
                    icon={<IconRotate />}
                    onClick={() => {
                      if (cropMode) return;
                      setImageRotateSteps(prev => (prev + 1) % 4);
                    }}
                    aria-label="旋转 90°"
                    disabled={cropMode}
                  />
                </Tooltip>
                <Tooltip content="裁剪为副本" position="bottom">
                  <Button
                    className="gallery-tool-button"
                    theme="borderless"
                    type="tertiary"
                    icon={<IconCrop />}
                    onClick={enterCropMode}
                    aria-label="裁剪为副本"
                    disabled={cropMode || cropApplying}
                  />
                </Tooltip>
                <Tooltip content={`缩放 ${Math.round(imageZoom * 100)}%`} position="bottom">
                  <div className="gallery-tool-readout" aria-label={`缩放 ${Math.round(imageZoom * 100)}%`}>
                    <IconSearchStroked />
                    <span>{Math.round(imageZoom * 100)}%</span>
                  </div>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="gallery-nav prev"
          onClick={() => moveDetail(-1)}
          aria-label="上一个"
          disabled={cropMode || cropApplying}
        >
          <IconChevronLeft size="large" />
        </button>
        {activeItem.kind === 'image' ? renderImageDetail() : renderVideoDetail()}
        <button
          type="button"
          className="gallery-nav next"
          onClick={() => moveDetail(1)}
          aria-label="下一个"
          disabled={cropMode || cropApplying}
        >
          <IconChevronRight size="large" />
        </button>
        {renderMetadataModal()}
      </div>
    );
  };

  if (loading) {
    return (
      <GalleryViewerWrapper>
        <div className="gallery-loading"><Spin size="large" tip="正在加载图集..." /></div>
      </GalleryViewerWrapper>
    );
  }

  if (error) {
    return (
      <GalleryViewerWrapper>
        <div className="gallery-empty">{error}</div>
      </GalleryViewerWrapper>
    );
  }

  return (
    <GalleryViewerWrapper>
      {activeIndex === null ? renderGrid() : renderDetail()}
      {renderImageKeepAlive()}
    </GalleryViewerWrapper>
  );
};

export default GalleryViewer;
