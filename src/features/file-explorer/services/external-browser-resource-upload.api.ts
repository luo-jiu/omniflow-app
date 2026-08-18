import type { UploadCandidateFile } from './desktop-upload-picker.api';
import { normalizeUploadRelativePath } from './upload-path-resolver';
import {
  EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE,
  type EmbeddedBrowserPageDragFallbackResource,
  type EmbeddedBrowserPageDragSourceKind,
  type EmbeddedBrowserStagePageDragRequest,
} from '@/features/file-transfer/model/browser-drag-transfer';
import { normalizeDownloadFileName } from '@/features/file-transfer/model/download-file-name';

type FileWithPath = File & { path: string };

export interface ExternalBrowserResourceDrop {
  fallbackResources: EmbeddedBrowserPageDragFallbackResource[];
  sessionId?: string;
  tabId?: string;
}

const RESOURCE_EXTENSIONS = new Set([
  '7z', 'apng', 'avif', 'avi', 'bmp', 'csv', 'doc', 'docx', 'epub', 'flac', 'gif', 'gz',
  'ico', 'jpeg', 'jpg', 'json', 'm4a', 'mkv', 'mov', 'mp3', 'mp4', 'ogg', 'opus', 'pdf',
  'png', 'ppt', 'pptx', 'rar', 'rtf', 'svg', 'tar', 'txt', 'wav', 'webm', 'webp', 'xls',
  'xlsx', 'xml', 'zip',
]);

const EXTERNAL_RESOURCE_DROP_TYPES = [
  EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE,
  'text/html',
  'text/uri-list',
];

function normalizeDataTransferTypes(dataTransfer: DataTransfer | null | undefined): string[] {
  return Array.from(dataTransfer?.types || []).map((type) => String(type || '').toLowerCase());
}

export function hasExternalUploadData(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = normalizeDataTransferTypes(dataTransfer);
  if (types.includes('files') || types.includes(EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE)) {
    return true;
  }
  if (!dataTransfer) return false;
  const html = dataTransfer.getData('text/html');
  if (html) {
    return /<(?:img\b|video\b[^>]*\bsrc\s*=|audio\b[^>]*\bsrc\s*=|source\b[^>]*\bsrc\s*=|a\b[^>]*\bdownload(?:\s|=|>))/i.test(html);
  }
  const uriList = extractUrlsFromUriList(dataTransfer.getData('text/uri-list'));
  if (uriList.some(hasResourceExtension)) {
    return true;
  }
  const plainUrl = normalizeUrl(dataTransfer.getData('text/plain'));
  if (plainUrl) {
    return hasResourceExtension(plainUrl);
  }
  return EXTERNAL_RESOURCE_DROP_TYPES.some((type) => types.includes(type));
}

function normalizeUrl(rawUrl: string, baseUrl?: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed, baseUrl || undefined);
    return ['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
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

function hasResourceExtension(url: string): boolean {
  const extension = extensionFromUrl(url);
  return Boolean(extension && RESOURCE_EXTENSIONS.has(extension));
}

function sanitizeFileName(input: string, fallback: string): string {
  const normalized = String(input || '').replace(/\s+/g, ' ').trim();
  const safeName = normalized ? normalizeDownloadFileName(normalized) : fallback;
  const extensionIndex = safeName.lastIndexOf('.');
  const rawExtension = extensionIndex > 0 ? safeName.slice(extensionIndex) : '';
  const extension = Array.from(rawExtension).length <= 20 ? rawExtension : '';
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;
  return `${Array.from(stem).slice(0, Math.max(1, 180 - extension.length)).join('')}${extension}`;
}

function fileNameFromUrl(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const rawName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (rawName) {
      return sanitizeFileName(rawName, `web-resource-${index + 1}`);
    }
  } catch {
    // Fall through to a stable generic name.
  }
  return `web-resource-${index + 1}`;
}

function parseCustomDragSource(dataTransfer: DataTransfer) {
  const rawValue = dataTransfer.getData(EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE);
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const sessionId = String(parsed.sessionId || '').trim();
    const tabId = String(parsed.tabId || '').trim();
    const sourceUrl = normalizeUrl(String(parsed.sourceUrl || ''));
    if (!sessionId) return null;
    return {
      sessionId,
      sourceUrl: sourceUrl || undefined,
      tabId: tabId || undefined,
    };
  } catch {
    return null;
  }
}

function extractSrcsetCandidate(value: string): string {
  const candidates = String(value || '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates[candidates.length - 1] || '';
}

function extractUrlsFromUriList(uriList: string): string[] {
  return String(uriList || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function pushResource(
  resources: EmbeddedBrowserPageDragFallbackResource[],
  seen: Set<string>,
  input: {
    allowNoKnownExtension?: boolean;
    mimeType?: string;
    pageUrl?: string;
    sourceKind?: EmbeddedBrowserPageDragSourceKind;
    suggestedFileName?: string;
    url: string;
  },
) {
  const sourceUrl = normalizeUrl(input.url, input.pageUrl);
  if (!sourceUrl || seen.has(sourceUrl)) return;
  if (!input.allowNoKnownExtension && !hasResourceExtension(sourceUrl)) return;
  seen.add(sourceUrl);
  resources.push({
    mimeType: String(input.mimeType || '').trim() || undefined,
    pageUrl: String(input.pageUrl || '').trim() || undefined,
    sourceKind: input.sourceKind,
    sourceUrl,
    suggestedFileName: sanitizeFileName(
      input.suggestedFileName || fileNameFromUrl(sourceUrl, resources.length),
      `web-resource-${resources.length + 1}`,
    ),
  });
}

function extractHtmlResources(
  html: string,
  resources: EmbeddedBrowserPageDragFallbackResource[],
  seen: Set<string>,
) {
  if (!html) return;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseUrl = normalizeUrl(doc.querySelector('base[href]')?.getAttribute('href') || '');

  doc.querySelectorAll('img').forEach((element) => {
    const sourceUrl = extractSrcsetCandidate(element.getAttribute('srcset') || '')
      || element.getAttribute('data-src')
      || element.getAttribute('data-original')
      || element.getAttribute('data-lazy-src')
      || element.getAttribute('src')
      || '';
    pushResource(resources, seen, {
      allowNoKnownExtension: true,
      pageUrl: baseUrl,
      sourceKind: 'image',
      url: sourceUrl,
    });
  });

  doc.querySelectorAll('a[href][download]').forEach((element) => {
    pushResource(resources, seen, {
      allowNoKnownExtension: true,
      mimeType: element.getAttribute('type') || undefined,
      pageUrl: baseUrl,
      sourceKind: 'link',
      suggestedFileName: element.getAttribute('download') || undefined,
      url: element.getAttribute('href') || '',
    });
  });

  doc.querySelectorAll('video[src],audio[src],source[src]').forEach((element) => {
    pushResource(resources, seen, {
      allowNoKnownExtension: true,
      mimeType: element.getAttribute('type') || undefined,
      pageUrl: baseUrl,
      sourceKind: 'media',
      url: element.getAttribute('src') || '',
    });
  });
}

export function extractExternalBrowserResourceDrop(
  dataTransfer: DataTransfer,
): ExternalBrowserResourceDrop {
  const customSource = parseCustomDragSource(dataTransfer);
  const resources: EmbeddedBrowserPageDragFallbackResource[] = [];
  const seen = new Set<string>();

  if (customSource?.sourceUrl) {
    pushResource(resources, seen, {
      allowNoKnownExtension: true,
      sourceKind: 'unknown',
      url: customSource.sourceUrl,
    });
  }

  const html = dataTransfer.getData('text/html');
  extractHtmlResources(html, resources, seen);

  const allowUnknownUri = resources.some((resource) => resource.sourceKind === 'image');
  extractUrlsFromUriList(dataTransfer.getData('text/uri-list')).forEach((url) => {
    pushResource(resources, seen, {
      allowNoKnownExtension: allowUnknownUri,
      sourceKind: allowUnknownUri ? 'image' : 'unknown',
      url,
    });
  });

  const plainUrl = normalizeUrl(dataTransfer.getData('text/plain'));
  if (plainUrl && (customSource || hasResourceExtension(plainUrl))) {
    pushResource(resources, seen, {
      allowNoKnownExtension: Boolean(customSource),
      sourceKind: 'unknown',
      url: plainUrl,
    });
  }

  return {
    fallbackResources: resources,
    sessionId: customSource?.sessionId,
    tabId: customSource?.tabId,
  };
}

function toUploadCandidate(input: {
  cleanupPath: string;
  fileName: string;
  filePath: string;
  mimeType?: string;
  size: number;
}): UploadCandidateFile {
  const fileName = sanitizeFileName(input.fileName, 'web-resource');
  const fileLike = {
    name: fileName,
    path: input.filePath,
    size: Number(input.size || 0),
    type: String(input.mimeType || ''),
  } as FileWithPath;
  return {
    cleanupPath: input.cleanupPath,
    file: fileLike,
    relativePath: normalizeUploadRelativePath(fileName) || fileName,
  };
}

export async function stageExternalBrowserResourceUploadCandidates(
  drop: ExternalBrowserResourceDrop,
): Promise<UploadCandidateFile[]> {
  const stagePageDrag = window.electronEmbeddedBrowser?.stagePageDrag;
  if (typeof stagePageDrag !== 'function') {
    throw new Error('当前环境不支持内置浏览器资源拖拽导入');
  }
  const request: EmbeddedBrowserStagePageDragRequest = {
    fallbackResources: drop.fallbackResources,
    sessionId: drop.sessionId,
    tabId: drop.tabId,
  };
  const stagedFiles = await stagePageDrag(request);
  return stagedFiles.map(toUploadCandidate);
}
