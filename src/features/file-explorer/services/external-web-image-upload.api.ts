import type { UploadCandidateFile } from './desktop-upload-picker.api';
import { normalizeUploadRelativePath } from './upload-path-resolver';

export interface ExternalWebImageDropItem {
  fileName: string;
  referer?: string;
  url: string;
}

type FileWithPath = File & { path: string };

const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

const WEB_IMAGE_DROP_TYPES = ['text/html', 'text/uri-list'];

function normalizeDataTransferTypes(dataTransfer: DataTransfer | null | undefined): string[] {
  return Array.from(dataTransfer?.types || []).map((type) => String(type || '').toLowerCase());
}

export function hasExternalUploadData(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = normalizeDataTransferTypes(dataTransfer);
  return types.includes('files') || WEB_IMAGE_DROP_TYPES.some((type) => types.includes(type));
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function extensionFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    const match = fileName.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function hasImageExtension(url: string): boolean {
  const ext = extensionFromUrl(url);
  return Boolean(ext && IMAGE_EXTENSIONS.has(ext));
}

function sanitizeFileName(input: string, fallback: string): string {
  const normalized = String(input || '')
    .replace(/[/\\]/g, '_')
    .replace(/[\0:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function fileNameFromUrl(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const rawName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    const ext = extensionFromUrl(url);
    if (rawName && ext && IMAGE_EXTENSIONS.has(ext)) {
      return sanitizeFileName(rawName, `web-image-${index + 1}.${ext}`);
    }
  } catch {
    // ignore
  }
  return `web-image-${index + 1}.jpg`;
}

function refererFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function pushImageUrl(
  items: ExternalWebImageDropItem[],
  seen: Set<string>,
  rawUrl: string,
  options: { allowNoImageExtension?: boolean; indexHint?: number } = {},
) {
  const url = normalizeUrl(rawUrl);
  if (!url || seen.has(url)) return;
  if (!options.allowNoImageExtension && !hasImageExtension(url)) return;
  seen.add(url);
  items.push({
    fileName: fileNameFromUrl(url, options.indexHint ?? items.length),
    referer: refererFromUrl(url),
    url,
  });
}

function extractImageUrlsFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const imageUrls: string[] = [];
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src) imageUrls.push(src);
  });
  return imageUrls;
}

function extractUrlsFromUriList(uriList: string): string[] {
  return String(uriList || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function extractExternalWebImageDropItems(dataTransfer: DataTransfer): ExternalWebImageDropItem[] {
  const items: ExternalWebImageDropItem[] = [];
  const seen = new Set<string>();

  const html = dataTransfer.getData('text/html');
  extractImageUrlsFromHtml(html).forEach((url, index) => {
    pushImageUrl(items, seen, url, { allowNoImageExtension: true, indexHint: index });
  });

  const uriList = dataTransfer.getData('text/uri-list');
  extractUrlsFromUriList(uriList).forEach((url, index) => {
    pushImageUrl(items, seen, url, { indexHint: index });
  });

  return items;
}

function toUploadCandidate(input: {
  fileName: string;
  filePath: string;
  size: number;
  tempRoot: string;
}): UploadCandidateFile {
  const fileName = sanitizeFileName(input.fileName, 'web-image.jpg');
  const fileLike = {
    name: fileName,
    path: input.filePath,
    size: Number(input.size || 0),
    type: '',
  } as FileWithPath;
  return {
    cleanupPath: input.tempRoot,
    file: fileLike,
    relativePath: normalizeUploadRelativePath(fileName) || fileName,
  };
}

export async function stageExternalWebImageUploadCandidates(
  items: ExternalWebImageDropItem[],
): Promise<UploadCandidateFile[]> {
  if (!items.length) return [];
  if (
    !window.electronAPI?.createTempImportDirectory
    || !window.electronAPI?.downloadUrlToPath
    || !window.electronAPI?.getTempImportFileInfo
    || !window.electronAPI?.cleanupTempImportPath
  ) {
    throw new Error('当前环境不支持网页图片拖拽导入');
  }

  const tempRoot = await window.electronAPI.createTempImportDirectory();
  const candidates: UploadCandidateFile[] = [];
  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const fileName = sanitizeFileName(item.fileName, `web-image-${index + 1}.jpg`);
      const headers: Record<string, string> = {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      };
      if (navigator.userAgent) {
        headers['User-Agent'] = navigator.userAgent;
      }
      if (item.referer) {
        headers.Referer = item.referer;
      }
      const filePath = await window.electronAPI.downloadUrlToPath(item.url, tempRoot, fileName, headers);
      const info = await window.electronAPI.getTempImportFileInfo(filePath);
      candidates.push(toUploadCandidate({
        fileName: info.name || fileName,
        filePath: info.filePath,
        size: info.size,
        tempRoot,
      }));
    }
  } catch (error) {
    await window.electronAPI.cleanupTempImportPath(tempRoot).catch(() => false);
    throw error;
  }
  return candidates;
}
