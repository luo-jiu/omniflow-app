import type { EmbeddedBrowserCapturedResource } from '../types';

export function formatBytes(value?: number) {
  if (!value || value <= 0) {
    return '未知大小';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatCapturedAt(value: number) {
  if (!value) {
    return '刚刚';
  }
  return new Date(value).toLocaleTimeString();
}

export function formatResourceTitle(resource: EmbeddedBrowserCapturedResource) {
  try {
    const pathname = new URL(resource.url).pathname;
    const fileName = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    if (fileName) {
      return fileName;
    }
  } catch {
    // Fall through to the URL fallback.
  }
  return resource.url.replace(/^https?:\/\//i, '').slice(0, 96);
}

export function formatResourceOrigin(resource: EmbeddedBrowserCapturedResource) {
  try {
    return new URL(resource.url).host;
  } catch {
    return resource.source;
  }
}

function isMediaLikeResource(resource: EmbeddedBrowserCapturedResource) {
  if (resource.kind === 'media' || resource.kind === 'manifest' || resource.kind === 'subtitle' || resource.kind === 'key') {
    return true;
  }
  const mimeType = String(resource.mimeType || '').toLowerCase();
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return true;
  }
  return false;
}

export function getResourceExtensionFilterKey(resource: EmbeddedBrowserCapturedResource) {
  if (resource.ext) {
    return resource.ext.toLowerCase();
  }
  if (resource.kind === 'manifest') {
    return 'manifest';
  }
  if (resource.kind === 'key') {
    return 'key';
  }
  if (resource.streamType) {
    return resource.streamType;
  }
  return resource.kind || 'other';
}

export function isManuallyMergeableResource(resource: EmbeddedBrowserCapturedResource) {
  return resource.kind === 'media' && Boolean(resource.resourceKey || /^https?:\/\//i.test(resource.url));
}

export function formatMergeResourceLabel(resource: EmbeddedBrowserCapturedResource | null | undefined) {
  if (!resource) {
    return '未选择';
  }
  const parts = [
    resource.streamType || resource.mimeType || resource.ext || resource.resourceType || 'media',
    resource.contentLength ? formatBytes(resource.contentLength) : '',
  ].filter(Boolean);
  return `${parts.join(' · ')} · ${resource.url.slice(0, 80)}`;
}

function inferManualMergeRole(resource: EmbeddedBrowserCapturedResource) {
  if (resource.streamType === 'audio' || resource.streamType === 'video') {
    return resource.streamType;
  }
  const mimeType = String(resource.mimeType || '').toLowerCase();
  if (mimeType.startsWith('audio/') || /(mp4a|aac|opus|vorbis|mp3|flac)/i.test(mimeType)) {
    return 'audio' as const;
  }
  if (mimeType.startsWith('video/') || /(avc1|av01|hev1|hvc1|vp8|vp9|theora)/i.test(mimeType)) {
    return 'video' as const;
  }
  const url = String(resource.url || '').toLowerCase();
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(url)) {
    return 'audio' as const;
  }
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(url)) {
    return 'video' as const;
  }
  return undefined;
}

export function createManualMergePair(resources: EmbeddedBrowserCapturedResource[]) {
  if (resources.length !== 2) {
    return null;
  }
  const [first, second] = resources;
  if (
    !first
    || !second
    || first.id === second.id
    || !isManuallyMergeableResource(first)
    || !isManuallyMergeableResource(second)
  ) {
    return null;
  }
  const firstRole = inferManualMergeRole(first);
  const secondRole = inferManualMergeRole(second);
  if (firstRole === 'video' && secondRole === 'audio') {
    return { audio: second, video: first };
  }
  if (firstRole === 'audio' && secondRole === 'video') {
    return { audio: first, video: second };
  }
  const firstSize = first.contentLength || 0;
  const secondSize = second.contentLength || 0;
  return firstSize >= secondSize
    ? { audio: second, video: first }
    : { audio: first, video: second };
}

export function matchesResourceFilter(resource: EmbeddedBrowserCapturedResource, pattern: RegExp | null) {
  if (!isMediaLikeResource(resource)) {
    return false;
  }
  if (!pattern) {
    return true;
  }
  const candidate = [
    resource.url,
    resource.mimeType || '',
    resource.ext || '',
    resource.resourceType || '',
    resource.kind,
    resource.streamType || '',
  ].join('\n');
  return pattern.test(candidate);
}
