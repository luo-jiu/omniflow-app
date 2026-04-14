import {
  isPageContextManagedResource,
} from '../model/embedded-browser-resource.presentation';
import {
  createEmbeddedBrowserHlsDownloadPlan,
  parseEmbeddedBrowserHlsManifest,
  type EmbeddedBrowserHlsManifest,
} from '../model/embedded-browser-hls-manifest';
import {
  normalizeHlsKeyCandidateValue,
  verifyEmbeddedBrowserHlsKeyCandidates,
  type EmbeddedBrowserHlsKeyCandidate,
} from '../model/embedded-browser-hls-key-verifier';
import {
  createEmbeddedBrowserMpdDownloadPlan,
  parseEmbeddedBrowserMpdManifest,
} from '../model/embedded-browser-mpd-manifest';
import {
  downloadEmbeddedBrowserHlsManifest,
  downloadEmbeddedBrowserMpdManifest,
  readEmbeddedBrowserCapturedResource,
} from './embedded-browser-resource.api';
import {
  decodeBase64Text,
  fetchResourceBinaryBase64,
  withResourceRefererHeader,
} from './embedded-browser-resource-request';
import type { EmbeddedBrowserCapturedResource } from '../types';

function deriveHlsDownloadFileName(resource: EmbeddedBrowserCapturedResource) {
  try {
    const fileName = decodeURIComponent(new URL(resource.url).pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.(m3u8|m3u)$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim();
    if (fileName) {
      return `${fileName}.mp4`;
    }
  } catch {
    // Fall through to a stable fallback.
  }
  return 'hls-media.mp4';
}

function deriveMpdDownloadFileName(resource: EmbeddedBrowserCapturedResource) {
  try {
    const fileName = decodeURIComponent(new URL(resource.url).pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.mpd$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim();
    if (fileName) {
      return `${fileName}.mp4`;
    }
  } catch {
    // Fall through to a stable fallback.
  }
  return 'dash-media.mp4';
}

export function isHlsResource(resource: EmbeddedBrowserCapturedResource) {
  const extension = String(resource.ext || '').toLowerCase();
  const mimeType = String(resource.mimeType || '').toLowerCase();
  const url = String(resource.url || '').toLowerCase();
  return resource.kind === 'manifest' && (
    extension === 'm3u8'
    || extension === 'm3u'
    || mimeType.includes('mpegurl')
    || /\.m3u8(?:$|[?#])/.test(url)
    || /\.m3u(?:$|[?#])/.test(url)
  );
}

export function isMpdResource(resource: EmbeddedBrowserCapturedResource) {
  const extension = String(resource.ext || '').toLowerCase();
  const mimeType = String(resource.mimeType || '').toLowerCase();
  const url = String(resource.url || '').toLowerCase();
  return resource.kind === 'manifest' && (
    extension === 'mpd'
    || mimeType.includes('dash+xml')
    || /\.mpd(?:$|[?#])/.test(url)
  );
}

async function readManifestResourceText(resource: EmbeddedBrowserCapturedResource) {
  if (resource.resourceKey && isPageContextManagedResource(resource)) {
    const extracted = await readEmbeddedBrowserCapturedResource(resource.tabId, resource.resourceKey);
    if (!extracted?.base64) {
      throw new Error('页面里的 manifest 暂时读不到，先重新深度捕获一次');
    }
    return {
      text: decodeBase64Text(extracted.base64),
      url: resource.pageUrl || resource.url,
    };
  }

  const headers = withResourceRefererHeader(resource);
  const response = await window.electronAPI.fetch(resource.url, { headers });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`manifest 请求失败：HTTP ${response.status}`);
  }
  const text = typeof response.body === 'string'
    ? response.body
    : JSON.stringify(response.body || '');
  return {
    text,
    url: resource.url,
  };
}

export async function analyzeHlsResource(resource: EmbeddedBrowserCapturedResource) {
  const { text, url } = await readManifestResourceText(resource);
  if (!text.includes('#EXTM3U')) {
    throw new Error('这条资源不像 HLS manifest');
  }
  const manifest = parseEmbeddedBrowserHlsManifest({
    baseUrl: url || resource.pageUrl || resource.url,
    text,
  });
  const plan = createEmbeddedBrowserHlsDownloadPlan({
    headers: withResourceRefererHeader(resource),
    manifest,
    manifestUrl: resource.url,
    pageUrl: resource.pageUrl,
  });
  const planText = JSON.stringify(plan, null, 2);
  await navigator.clipboard.writeText(planText);
  return {
    manifest,
    planText,
  };
}

export async function saveHlsResourceWithFfmpeg(resource: EmbeddedBrowserCapturedResource) {
  if (!/^https?:\/\//i.test(resource.url)) {
    throw new Error('当前只支持直接保存网络 m3u8，blob 或页内内存 m3u8 先用“解析 HLS”看下载计划');
  }
  const result = await downloadEmbeddedBrowserHlsManifest(resource.tabId, {
    headers: withResourceRefererHeader(resource),
    manifestUrl: resource.url,
    suggestedFileName: deriveHlsDownloadFileName(resource),
  });
  if (result.cancelled) {
    return result;
  }
  if (!result.ok) {
    throw new Error(result.error || 'HLS 保存失败');
  }
  return result;
}

export async function analyzeMpdResource(resource: EmbeddedBrowserCapturedResource) {
  const { text, url } = await readManifestResourceText(resource);
  const manifest = parseEmbeddedBrowserMpdManifest({
    baseUrl: url || resource.pageUrl || resource.url,
    text,
  });
  const plan = createEmbeddedBrowserMpdDownloadPlan({
    headers: withResourceRefererHeader(resource),
    manifest,
    manifestUrl: resource.url,
    pageUrl: resource.pageUrl,
  });
  const planText = JSON.stringify(plan, null, 2);
  await navigator.clipboard.writeText(planText);
  return {
    manifest,
    planText,
  };
}

export async function saveMpdResourceWithFfmpeg(resource: EmbeddedBrowserCapturedResource) {
  if (!/^https?:\/\//i.test(resource.url)) {
    throw new Error('当前只支持直接保存网络 mpd，blob 或页内内存 mpd 先用“解析 MPD”看下载计划');
  }
  const result = await downloadEmbeddedBrowserMpdManifest(resource.tabId, {
    headers: withResourceRefererHeader(resource),
    manifestUrl: resource.url,
    suggestedFileName: deriveMpdDownloadFileName(resource),
  });
  if (result.cancelled) {
    return result;
  }
  if (!result.ok) {
    throw new Error(result.error || 'MPD 保存失败');
  }
  return result;
}

function addHlsKeyCandidate(
  candidates: Map<string, EmbeddedBrowserHlsKeyCandidate>,
  candidate: EmbeddedBrowserHlsKeyCandidate,
) {
  const normalizedBase64 = normalizeHlsKeyCandidateValue(candidate.base64);
  if (!normalizedBase64) {
    return;
  }
  candidates.set(normalizedBase64, {
    ...candidate,
    base64: normalizedBase64,
  });
}

async function readCapturedKeyCandidate(resource: EmbeddedBrowserCapturedResource) {
  if (resource.resourceKey && isPageContextManagedResource(resource)) {
    const extracted = await readEmbeddedBrowserCapturedResource(resource.tabId, resource.resourceKey);
    if (!extracted?.base64) {
      return null;
    }
    return {
      base64: extracted.base64,
      label: extracted.fileName || resource.url,
      source: 'captured-key',
    } satisfies EmbeddedBrowserHlsKeyCandidate;
  }
  const normalizedFromValue = normalizeHlsKeyCandidateValue(resource.url);
  if (normalizedFromValue) {
    return {
      base64: normalizedFromValue,
      label: resource.url,
      source: 'captured-key',
    } satisfies EmbeddedBrowserHlsKeyCandidate;
  }
  if (!/^https?:\/\//i.test(resource.url)) {
    return null;
  }
  const base64 = await fetchResourceBinaryBase64(
    resource.url,
    withResourceRefererHeader(resource),
    64,
  );
  return {
    base64,
    label: resource.url,
    source: 'captured-key',
  } satisfies EmbeddedBrowserHlsKeyCandidate;
}

async function collectHlsKeyCandidates(input: {
  manifest: EmbeddedBrowserHlsManifest
  manifestResource: EmbeddedBrowserCapturedResource
  resources: EmbeddedBrowserCapturedResource[]
}) {
  const candidates = new Map<string, EmbeddedBrowserHlsKeyCandidate>();
  const headers = withResourceRefererHeader(input.manifestResource);
  await Promise.all(input.manifest.keys.map(async (key) => {
    const inlineKey = normalizeHlsKeyCandidateValue(key.uri || '');
    if (inlineKey) {
      addHlsKeyCandidate(candidates, {
        base64: inlineKey,
        label: key.uri || 'manifest inline key',
        source: 'manifest-key-url',
      });
      return;
    }
    if (!key.url || !/^https?:\/\//i.test(key.url)) {
      return;
    }
    try {
      const base64 = await fetchResourceBinaryBase64(key.url, headers, 64);
      addHlsKeyCandidate(candidates, {
        base64,
        label: key.url,
        source: 'manifest-key-url',
      });
    } catch {
      // Network key fetch can fail on hotlink-protected sites; captured candidates may still work.
    }
  }));

  const keyResources = input.resources.filter((resource) => resource.kind === 'key');
  await Promise.all(keyResources.map(async (resource) => {
    try {
      const candidate = await readCapturedKeyCandidate(resource);
      if (candidate) {
        addHlsKeyCandidate(candidates, candidate);
      }
    } catch {
      // Keep the verifier best-effort; one bad candidate should not block the rest.
    }
  }));

  return Array.from(candidates.values());
}

export async function verifyHlsResourceKey(input: {
  manifest: EmbeddedBrowserHlsManifest
  manifestResource: EmbeddedBrowserCapturedResource
  resources: EmbeddedBrowserCapturedResource[]
}) {
  const encryptedSegment = input.manifest.segments.find((segment) => (
    segment.key && segment.key.method.toUpperCase() === 'AES-128'
  ));
  if (!encryptedSegment?.key) {
    throw new Error('这个 manifest 没有 AES-128 key 片段需要验证');
  }
  const candidates = await collectHlsKeyCandidates(input);
  if (candidates.length === 0) {
    throw new Error('还没有可验证的 key 候选');
  }
  const encryptedSegmentBase64 = await fetchResourceBinaryBase64(
    encryptedSegment.url,
    withResourceRefererHeader(input.manifestResource),
    16 * 1024 * 1024,
  );
  return verifyEmbeddedBrowserHlsKeyCandidates({
    candidates,
    encryptedSegmentBase64,
    iv: encryptedSegment.key.iv,
    sequence: encryptedSegment.sequence,
  });
}
