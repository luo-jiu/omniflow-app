import {
  moveNodesBatch,
  uploadLocalPathAndCreateNode,
} from '@/features/file-explorer/services/file.api';
import { refreshDirectoryInTree } from '@/features/file-explorer/services/tree-locate';

export interface CropSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageNaturalSize {
  width: number;
  height: number;
}

export interface CropSaveInput {
  beforeNodeId: number;
  existingNames?: string[];
  imageRect: CropBounds;
  libraryId: number;
  naturalSize: ImageNaturalSize;
  parentId: number;
  selection: CropSelection;
  sourceFileName?: string | null;
  sourceUrl: string;
}

interface OutputFormat {
  ext: string;
  mimeType: string;
  quality?: number;
}

const COPY_SUFFIX = ' 副本';
export const MIN_CROP_SELECTION_SIZE = 32;
const MIN_SOURCE_PIXELS = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeFileName(value?: string | null): string {
  return String(value || '').trim();
}

function splitFileName(fileName?: string | null): { baseName: string; ext: string } {
  const normalized = normalizeFileName(fileName) || 'image';
  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return { baseName: normalized, ext: '' };
  }
  return {
    baseName: normalized.slice(0, dotIndex),
    ext: normalized.slice(dotIndex + 1).toLowerCase(),
  };
}

function resolveOutputFormat(sourceFileName?: string | null): OutputFormat {
  const ext = splitFileName(sourceFileName).ext;
  if (ext === 'jpg' || ext === 'jpeg') {
    return { ext, mimeType: 'image/jpeg', quality: 0.92 };
  }
  if (ext === 'webp') {
    return { ext, mimeType: 'image/webp', quality: 0.94 };
  }
  if (ext === 'png') {
    return { ext, mimeType: 'image/png' };
  }
  return { ext: 'png', mimeType: 'image/png' };
}

function buildCopyName(sourceFileName: string | null | undefined, outputExt: string, existingNames: string[] = []): string {
  const { baseName } = splitFileName(sourceFileName);
  const normalizedExisting = new Set(existingNames.map(name => normalizeFileName(name).toLowerCase()).filter(Boolean));
  const ext = outputExt.replace(/^\./, '') || 'png';
  for (let index = 0; index < 10000; index += 1) {
    const suffix = index === 0 ? COPY_SUFFIX : `${COPY_SUFFIX}${index}`;
    const candidate = `${baseName}${suffix}.${ext}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseName}${COPY_SUFFIX}${Date.now()}.${ext}`;
}

function headersContentType(headers: Record<string, string | string[]> | undefined): string | null {
  if (!headers) return null;
  const value = headers['content-type'] ?? headers['Content-Type'];
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

async function resolveDrawableUrl(sourceUrl: string): Promise<string> {
  const normalizedUrl = String(sourceUrl || '').trim();
  if (!normalizedUrl) throw new Error('图片地址为空');
  if (/^(data|file|blob):/i.test(normalizedUrl)) {
    return normalizedUrl;
  }
  const fetchBinary = window.electronAPI?.fetchBinary;
  if (!fetchBinary) {
    return normalizedUrl;
  }
  const result = await fetchBinary(normalizedUrl);
  if (Number(result?.status || 0) >= 400 || !result?.base64) {
    throw new Error('读取图片数据失败');
  }
  const mimeType = headersContentType(result.headers)?.split(';')[0]?.trim() || 'image/png';
  return `data:${mimeType};base64,${result.base64}`;
}

async function loadImageForCanvas(sourceUrl: string): Promise<HTMLImageElement> {
  const drawableUrl = await resolveDrawableUrl(sourceUrl);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.decoding = 'async';
    if (!/^(data|file|blob):/i.test(drawableUrl)) {
      image.crossOrigin = 'anonymous';
    }
    image.src = drawableUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, format: OutputFormat): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('生成裁剪图片失败'));
        return;
      }
      resolve(blob);
    }, format.mimeType, format.quality);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取裁剪图片失败'));
    reader.readAsDataURL(blob);
  });
}

export function getDisplayedImageBounds(
  container: HTMLElement | null,
  image: HTMLImageElement | null,
): CropBounds | null {
  if (!container || !image) return null;
  const containerRect = container.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0 || imageRect.width <= 0 || imageRect.height <= 0) {
    return null;
  }
  const left = clamp(imageRect.left, containerRect.left, containerRect.right);
  const top = clamp(imageRect.top, containerRect.top, containerRect.bottom);
  const right = clamp(imageRect.right, containerRect.left, containerRect.right);
  const bottom = clamp(imageRect.bottom, containerRect.top, containerRect.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width < 8 || height < 8) return null;
  return {
    x: left - containerRect.left,
    y: top - containerRect.top,
    width,
    height,
  };
}

export function createDefaultCropSelection(bounds: CropBounds): CropSelection {
  const width = Math.min(bounds.width, Math.max(MIN_CROP_SELECTION_SIZE, bounds.width * 0.72));
  const height = Math.min(bounds.height, Math.max(MIN_CROP_SELECTION_SIZE, bounds.height * 0.72));
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

export function isCropBoundsUsable(bounds: CropBounds | null): bounds is CropBounds {
  return Boolean(
    bounds
    && bounds.width >= MIN_CROP_SELECTION_SIZE
    && bounds.height >= MIN_CROP_SELECTION_SIZE,
  );
}

export function getImageRectInContainer(
  container: HTMLElement | null,
  image: HTMLImageElement | null,
): CropBounds | null {
  if (!container || !image) return null;
  const containerRect = container.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  if (imageRect.width <= 0 || imageRect.height <= 0) return null;
  return {
    x: imageRect.left - containerRect.left,
    y: imageRect.top - containerRect.top,
    width: imageRect.width,
    height: imageRect.height,
  };
}

async function createCroppedBlob(input: CropSaveInput, format: OutputFormat): Promise<Blob> {
  const image = await loadImageForCanvas(input.sourceUrl);
  const sourceWidth = input.naturalSize.width || image.naturalWidth;
  const sourceHeight = input.naturalSize.height || image.naturalHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('图片尺寸异常');
  }

  const rawX = ((input.selection.x - input.imageRect.x) / input.imageRect.width) * sourceWidth;
  const rawY = ((input.selection.y - input.imageRect.y) / input.imageRect.height) * sourceHeight;
  const rawWidth = (input.selection.width / input.imageRect.width) * sourceWidth;
  const rawHeight = (input.selection.height / input.imageRect.height) * sourceHeight;
  const sourceX = clamp(Math.floor(rawX), 0, sourceWidth - MIN_SOURCE_PIXELS);
  const sourceY = clamp(Math.floor(rawY), 0, sourceHeight - MIN_SOURCE_PIXELS);
  const sourceRight = clamp(Math.ceil(rawX + rawWidth), sourceX + MIN_SOURCE_PIXELS, sourceWidth);
  const sourceBottom = clamp(Math.ceil(rawY + rawHeight), sourceY + MIN_SOURCE_PIXELS, sourceHeight);
  const cropWidth = sourceRight - sourceX;
  const cropHeight = sourceBottom - sourceY;

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持图片裁剪');
  if (format.mimeType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cropWidth, cropHeight);
  }
  ctx.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvasToBlob(canvas, format);
}

export async function saveCroppedImageCopy(input: CropSaveInput) {
  if (!window.electronAPI?.createStagedBinaryFile) {
    throw new Error('当前环境不支持保存裁剪图片');
  }
  const outputFormat = resolveOutputFormat(input.sourceFileName);
  const outputFileName = buildCopyName(input.sourceFileName, outputFormat.ext, input.existingNames);
  const blob = await createCroppedBlob(input, outputFormat);
  const base64 = await blobToBase64(blob);
  const staged = await window.electronAPI.createStagedBinaryFile(outputFileName, base64);

  try {
    const createdNode = await uploadLocalPathAndCreateNode(staged.filePath, input.parentId, input.libraryId, {
      contentType: outputFormat.mimeType,
      conflictPolicy: 'auto_rename',
    }) as Record<string, unknown>;
    const createdNodeId = Number(createdNode?.id);
    if (Number.isFinite(createdNodeId) && createdNodeId > 0) {
      await moveNodesBatch({
        items: [{ nodeId: createdNodeId, name: outputFileName }],
        newParentId: input.parentId,
        beforeNodeId: input.beforeNodeId,
        libraryId: input.libraryId,
      });
    }
    refreshDirectoryInTree(input.parentId);
    return createdNode;
  } finally {
    await window.electronAPI.cleanupTempImportPath?.(staged.filePath).catch(() => false);
  }
}
