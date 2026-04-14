import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import styled from 'styled-components';
import EmbeddedBrowserCatchToolkitCard from './EmbeddedBrowserCatchToolkitCard';
import { useEmbeddedBrowserCatchToolkit } from '../hooks/useEmbeddedBrowserCatchToolkit';
import { useEmbeddedBrowserResources } from '../hooks/useEmbeddedBrowserResources';
import {
  createEmbeddedBrowserResourceSections,
  findMergeableResourcePair,
  isMseCapturedResource,
  isPageContextManagedResource,
  isPreviewableResource,
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
  type EmbeddedBrowserHlsKeyVerificationResult,
} from '../model/embedded-browser-hls-key-verifier';
import {
  createEmbeddedBrowserMpdDownloadPlan,
  parseEmbeddedBrowserMpdManifest,
  type EmbeddedBrowserMpdManifest,
} from '../model/embedded-browser-mpd-manifest';
import {
  exportEmbeddedBrowserCapturedResource,
  mergeEmbeddedBrowserCapturedMseResources,
  openEmbeddedBrowserCapturedResource,
  previewEmbeddedBrowserCapturedResource,
  readEmbeddedBrowserCapturedResource,
} from '../services/embedded-browser-resource.api';
import type { EmbeddedBrowserCapturedResource } from '../types';

type EmbeddedBrowserResourcePanelProps = {
  activeTabId: string | null;
  currentPageUrl?: string;
};

const RESOURCE_FILTER_STORAGE_KEY = 'embedded-browser:resource-filter-regex';
const DEFAULT_MEDIA_RESOURCE_REGEX = String.raw`(blob:|key|base64key|\.((m3u8|m3u|mpd|m4s|mp4|m4v|m4a|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp|vtt|srt))(?:$|[?#]))`;

const PanelShell = styled.aside`
  width: 360px;
  min-width: 320px;
  max-width: 420px;
  border-left: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  display: flex;
  flex-direction: column;
  min-height: 0;

  .resource-panel-header {
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .resource-panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .resource-panel-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-panel-subtitle {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--app-text-muted);
    word-break: break-all;
  }

  .resource-panel-badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-panel-badge {
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 1;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
    background: var(--app-bg);
  }

  .resource-panel-badge.is-active {
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 10%, white);
  }

  .resource-panel-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .resource-panel-filter {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-panel-filter-label {
    font-size: 12px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }

  .resource-panel-filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .resource-panel-filter-input {
    flex: 1;
    min-width: 0;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    padding: 0 10px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-panel-filter-input:focus {
    outline: none;
    border-color: var(--semi-color-primary);
  }

  .resource-panel-filter-reset {
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 12px;
    flex-shrink: 0;
  }

  .resource-panel-filter-error {
    font-size: 12px;
    color: #c93c37;
    line-height: 1.5;
  }

  .resource-panel-btn {
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .resource-panel-btn.primary {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary);
    color: #fff;
  }

  .resource-panel-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .resource-panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-section-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 4px 0;
  }

  .resource-section-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .resource-section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-section-count {
    font-size: 11px;
    line-height: 1;
    padding: 4px 7px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-muted);
  }

  .resource-section-description {
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .resource-panel-empty {
    padding: 16px;
    border-radius: 12px;
    border: 1px dashed var(--app-border);
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.7;
    background: var(--app-bg);
  }

  .resource-toolkit-card {
    border: 1px solid var(--app-border);
    border-radius: 12px;
    background: var(--app-bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .resource-toolkit-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-toolkit-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--app-text);
  }

  .resource-toolkit-description {
    font-size: 12px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  .resource-toolkit-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .resource-toolkit-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-bg-elevated) 70%, white);
  }

  .resource-toolkit-meta-label {
    font-size: 11px;
    color: var(--app-text-muted);
  }

  .resource-toolkit-meta-value {
    font-size: 12px;
    line-height: 1.6;
    color: var(--app-text);
    word-break: break-all;
  }

  .resource-toolkit-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-toolkit-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--app-text);
  }

  .resource-toolkit-toggle input {
    margin: 0;
  }

  .resource-toolkit-input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--app-text);
  }

  .resource-toolkit-input {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-text);
    padding: 0 10px;
    font-size: 12px;
  }

  .resource-toolkit-input:focus {
    outline: none;
    border-color: var(--semi-color-primary);
  }

  .resource-toolkit-warning {
    font-size: 11px;
    line-height: 1.5;
    color: #c93c37;
  }

  .resource-toolkit-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-card {
    border: 1px solid var(--app-border);
    border-radius: 12px;
    background: var(--app-bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .resource-card-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .resource-chip {
    padding: 4px 7px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 1;
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text-muted);
  }

  .resource-url {
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-page-url {
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.6;
    word-break: break-all;
  }

  .resource-request-meta {
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.6;
    word-break: break-all;
  }

  .resource-hls-analysis {
    border: 1px dashed var(--app-border);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.6;
    background: color-mix(in srgb, var(--app-bg-elevated) 70%, white);
  }

  .resource-hls-analysis strong {
    color: var(--app-text);
    font-weight: 700;
  }

  .resource-hls-analysis code {
    color: var(--app-text);
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .resource-card-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resource-card-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 12px;
  }
`;

function formatBytes(value?: number) {
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

function formatCapturedAt(value: number) {
  if (!value) {
    return '刚刚';
  }
  return new Date(value).toLocaleTimeString();
}

async function copyResourceUrl(url: string) {
  await navigator.clipboard.writeText(url);
  Toast.success('链接已复制');
}

function shellEscape(value: string) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function buildResourceCurlCommand(resource: EmbeddedBrowserCapturedResource) {
  const lines = ['curl'];
  const method = String(resource.method || 'GET').trim().toUpperCase();
  if (method && method !== 'GET') {
    lines.push(`  -X ${method}`);
  }
  const requestHeaders = {
    ...(resource.requestHeaders || {}),
  };
  if (resource.referer && !requestHeaders.referer) {
    requestHeaders.referer = resource.referer;
  }
  Object.entries(requestHeaders).forEach(([headerName, headerValue]) => {
    if (!headerValue) {
      return;
    }
    lines.push(`  -H ${shellEscape(`${headerName}: ${headerValue}`)}`);
  });
  lines.push(`  ${shellEscape(resource.url)}`);
  return lines.join(' \\\n');
}

async function copyResourceCurl(resource: EmbeddedBrowserCapturedResource) {
  await navigator.clipboard.writeText(buildResourceCurlCommand(resource));
  Toast.success('curl 已复制');
}

function decodeBase64Text(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function isHlsResource(resource: EmbeddedBrowserCapturedResource) {
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

function isMpdResource(resource: EmbeddedBrowserCapturedResource) {
  const extension = String(resource.ext || '').toLowerCase();
  const mimeType = String(resource.mimeType || '').toLowerCase();
  const url = String(resource.url || '').toLowerCase();
  return resource.kind === 'manifest' && (
    extension === 'mpd'
    || mimeType.includes('dash+xml')
    || /\.mpd(?:$|[?#])/.test(url)
  );
}

function withResourceRefererHeader(resource: EmbeddedBrowserCapturedResource) {
  const headers = {
    ...(resource.requestHeaders || {}),
  };
  const hasReferer = Object.keys(headers).some((key) => key.toLowerCase() === 'referer');
  if (resource.referer && !hasReferer) {
    headers.referer = resource.referer;
  }
  return headers;
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

async function analyzeHlsResource(resource: EmbeddedBrowserCapturedResource) {
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

async function analyzeMpdResource(resource: EmbeddedBrowserCapturedResource) {
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

async function fetchResourceBinaryBase64(
  url: string,
  headers: Record<string, string>,
  maxBytes?: number,
) {
  const response = await window.electronAPI.fetchBinary(url, {
    headers,
    maxBytes,
  });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`二进制资源请求失败：HTTP ${response.status}`);
  }
  return response.base64;
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

async function verifyHlsResourceKey(input: {
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

function openResourceUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function previewResource(resource: EmbeddedBrowserCapturedResource) {
  if (isMseCapturedResource(resource)) {
    await openCapturedResource(resource);
    return;
  }
  const previewed = await previewEmbeddedBrowserCapturedResource(resource.tabId, {
    mimeType: resource.mimeType,
    streamType: resource.streamType,
    title: resource.pageUrl || resource.url,
    url: resource.url,
  });
  if (!previewed) {
    throw new Error('页面内预览失败');
  }
}

async function openCapturedResource(resource: EmbeddedBrowserCapturedResource) {
  if (!resource.resourceKey) {
    openResourceUrl(resource.url);
    return;
  }
  const opened = await openEmbeddedBrowserCapturedResource(resource.tabId, resource.resourceKey);
  if (!opened) {
    throw new Error('当前页面里的流还没有准备好，先继续播放几秒再试试');
  }
  Toast.success('已打开预览');
}

async function exportCapturedResource(resource: EmbeddedBrowserCapturedResource) {
  if (!resource.resourceKey) {
    await copyResourceUrl(resource.url);
    return;
  }
  const exported = await exportEmbeddedBrowserCapturedResource(resource.tabId, resource.resourceKey);
  if (!exported) {
    throw new Error('当前页面里的流还没有准备好，先继续播放几秒再试试');
  }
  Toast.success('已触发导出');
}

async function mergeCapturedResources(resources: {
  audio: EmbeddedBrowserCapturedResource;
  video: EmbeddedBrowserCapturedResource;
}) {
  const mergeResult = await mergeEmbeddedBrowserCapturedMseResources(resources.video.tabId, {
    audioResourceKey: resources.audio.resourceKey,
    videoResourceKey: resources.video.resourceKey,
  });
  if (mergeResult.cancelled) {
    return;
  }
  if (!mergeResult.ok) {
    throw new Error(mergeResult.error || '合并失败');
  }
  Toast.success('已完成音视频合并');
}

function loadResourceFilterDraft() {
  const value = window.localStorage.getItem(RESOURCE_FILTER_STORAGE_KEY);
  return String(value || DEFAULT_MEDIA_RESOURCE_REGEX);
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

function matchesResourceFilter(resource: EmbeddedBrowserCapturedResource, pattern: RegExp | null) {
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

type HlsAnalysisState = {
  error?: string
  keyVerification?: EmbeddedBrowserHlsKeyVerificationResult
  keyVerificationLoading?: boolean
  loading: boolean
  manifest?: EmbeddedBrowserHlsManifest
  planText?: string
}

type MpdAnalysisState = {
  error?: string
  loading: boolean
  manifest?: EmbeddedBrowserMpdManifest
  planText?: string
}

const ResourceCard: React.FC<{
  resource: EmbeddedBrowserCapturedResource
  resources: EmbeddedBrowserCapturedResource[]
}> = ({ resource, resources }) => {
  const [hlsAnalysis, setHlsAnalysis] = React.useState<HlsAnalysisState>({ loading: false });
  const [mpdAnalysis, setMpdAnalysis] = React.useState<MpdAnalysisState>({ loading: false });
  const canAnalyzeHls = isHlsResource(resource);
  const canAnalyzeMpd = isMpdResource(resource);

  const handleAnalyzeHls = React.useCallback(() => {
    setHlsAnalysis((previous) => ({
      ...previous,
      error: undefined,
      loading: true,
    }));
    void analyzeHlsResource(resource)
      .then((result) => {
        setHlsAnalysis({
          keyVerification: undefined,
          keyVerificationLoading: false,
          loading: false,
          manifest: result.manifest,
          planText: result.planText,
        });
        Toast.success('HLS 解析完成，下载计划 JSON 已复制');
      })
      .catch((error: any) => {
        setHlsAnalysis({
          error: error?.message || 'HLS 解析失败',
          keyVerificationLoading: false,
          loading: false,
        });
        Toast.error(error?.message || 'HLS 解析失败');
      });
  }, [resource]);

  const handleAnalyzeMpd = React.useCallback(() => {
    setMpdAnalysis((previous) => ({
      ...previous,
      error: undefined,
      loading: true,
    }));
    void analyzeMpdResource(resource)
      .then((result) => {
        setMpdAnalysis({
          loading: false,
          manifest: result.manifest,
          planText: result.planText,
        });
        Toast.success('MPD 解析完成，下载计划 JSON 已复制');
      })
      .catch((error: any) => {
        setMpdAnalysis({
          error: error?.message || 'MPD 解析失败',
          loading: false,
        });
        Toast.error(error?.message || 'MPD 解析失败');
      });
  }, [resource]);

  const handleVerifyHlsKey = React.useCallback(() => {
    if (!hlsAnalysis.manifest) {
      return;
    }
    setHlsAnalysis((previous) => ({
      ...previous,
      error: undefined,
      keyVerification: undefined,
      keyVerificationLoading: true,
    }));
    void verifyHlsResourceKey({
      manifest: hlsAnalysis.manifest,
      manifestResource: resource,
      resources,
    })
      .then((result) => {
        setHlsAnalysis((previous) => ({
          ...previous,
          keyVerification: result,
          keyVerificationLoading: false,
        }));
        if (result.mediaAlreadyReadable) {
          Toast.success('片段本身可读，不需要 key');
          return;
        }
        if (result.ok && result.candidate) {
          Toast.success('已验证到可用 key');
          return;
        }
        Toast.warning(result.error || '没有验证到可用 key');
      })
      .catch((error: any) => {
        setHlsAnalysis((previous) => ({
          ...previous,
          keyVerification: {
            error: error?.message || 'key 验证失败',
            mediaAlreadyReadable: false,
            ok: false,
          },
          keyVerificationLoading: false,
        }));
        Toast.error(error?.message || 'key 验证失败');
      });
  }, [hlsAnalysis.manifest, resource, resources]);

  return (
    <div className="resource-card">
      <div className="resource-card-meta">
        <span className="resource-chip">{resource.kind}</span>
        {resource.streamType ? <span className="resource-chip">{resource.streamType}</span> : null}
        {isMseCapturedResource(resource) ? <span className="resource-chip">playable</span> : null}
        <span className="resource-chip">{resource.source}</span>
        {resource.ext ? <span className="resource-chip">.{resource.ext}</span> : null}
        {resource.statusCode ? <span className="resource-chip">{resource.statusCode}</span> : null}
        {resource.contentLength ? <span className="resource-chip">{formatBytes(resource.contentLength)}</span> : null}
        <span className="resource-chip">{formatCapturedAt(resource.capturedAt)}</span>
      </div>
      <div className="resource-url">{resource.url}</div>
      {resource.pageUrl ? (
        <div className="resource-page-url">来源页面：{resource.pageUrl}</div>
      ) : null}
      {resource.referer ? (
        <div className="resource-request-meta">Referer：{resource.referer}</div>
      ) : null}
      {resource.requestHeaders && Object.keys(resource.requestHeaders).length ? (
        <div className="resource-request-meta">
          请求头：{Object.keys(resource.requestHeaders).join(', ')}
        </div>
      ) : null}
      {hlsAnalysis.manifest ? (
        <div className="resource-hls-analysis">
          <div>
            <strong>HLS：</strong>
            {hlsAnalysis.manifest.isMaster ? 'Master playlist' : 'Media playlist'}
            {' · '}
            {hlsAnalysis.manifest.isLive ? '直播' : '点播'}
          </div>
          <div>
            variants {hlsAnalysis.manifest.variants.length}
            {' · '}
            segments {hlsAnalysis.manifest.segmentCount}
            {' · '}
            keys {hlsAnalysis.manifest.keys.length}
            {' · '}
            maps {hlsAnalysis.manifest.maps.length}
            {' · '}
            {Math.round(hlsAnalysis.manifest.durationSeconds)}s
          </div>
          {hlsAnalysis.manifest.variants[0] ? (
            <code>{hlsAnalysis.manifest.variants[0].url}</code>
          ) : hlsAnalysis.manifest.segments[0] ? (
            <code>{hlsAnalysis.manifest.segments[0].url}</code>
          ) : null}
          {hlsAnalysis.keyVerification ? (
            <div>
              <strong>key 验证：</strong>
              {hlsAnalysis.keyVerification.mediaAlreadyReadable
                ? '片段本身可读，不需要 key'
                : hlsAnalysis.keyVerification.ok && hlsAnalysis.keyVerification.candidate
                  ? `命中 ${hlsAnalysis.keyVerification.candidate.label}`
                  : hlsAnalysis.keyVerification.error || '未命中'}
            </div>
          ) : null}
        </div>
      ) : hlsAnalysis.error ? (
        <div className="resource-hls-analysis">
          HLS 解析失败：{hlsAnalysis.error}
        </div>
      ) : null}
      {mpdAnalysis.manifest ? (
        <div className="resource-hls-analysis">
          <div>
            <strong>MPD：</strong>
            {mpdAnalysis.manifest.hasDrm ? '检测到 DRM' : '未检测到 DRM'}
            {' · '}
            representations {mpdAnalysis.manifest.representations.length}
            {' · '}
            {Math.round(mpdAnalysis.manifest.durationSeconds || 0)}s
          </div>
          <div>
            video {mpdAnalysis.manifest.representations.filter((item) => item.contentType === 'video').length}
            {' · '}
            audio {mpdAnalysis.manifest.representations.filter((item) => item.contentType === 'audio').length}
          </div>
          {mpdAnalysis.manifest.protections[0] ? (
            <code>{mpdAnalysis.manifest.protections[0].encryptionType}</code>
          ) : mpdAnalysis.manifest.representations[0]?.segments[0] ? (
            <code>{mpdAnalysis.manifest.representations[0].segments[0].url}</code>
          ) : mpdAnalysis.manifest.representations[0]?.initializationUrl ? (
            <code>{mpdAnalysis.manifest.representations[0].initializationUrl}</code>
          ) : null}
        </div>
      ) : mpdAnalysis.error ? (
        <div className="resource-hls-analysis">
          MPD 解析失败：{mpdAnalysis.error}
        </div>
      ) : null}
      <div className="resource-card-actions">
        {isPreviewableResource(resource) ? (
          <>
            <button
              type="button"
              className="resource-card-btn"
              onClick={() => {
                void previewResource(resource).catch((error: any) => {
                  Toast.error(error?.message || '预览失败');
                });
              }}
            >
              预览
            </button>
            {isPageContextManagedResource(resource) ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void exportCapturedResource(resource).catch((error: any) => {
                    Toast.error(error?.message || '导出失败');
                  });
                }}
              >
                页内导出
              </button>
            ) : (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void copyResourceCurl(resource);
                }}
              >
                复制 curl
              </button>
            )}
            {!isPageContextManagedResource(resource) ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void copyResourceUrl(resource.url);
                }}
              >
                复制链接
              </button>
            ) : null}
          </>
        ) : (
          <>
            {isPageContextManagedResource(resource) ? (
              <>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void openCapturedResource(resource).catch((error: any) => {
                      Toast.error(error?.message || '打开失败');
                    });
                  }}
                >
                  页内打开
                </button>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void exportCapturedResource(resource).catch((error: any) => {
                      Toast.error(error?.message || '导出失败');
                    });
                  }}
                >
                  页内导出
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void copyResourceUrl(resource.url);
                  }}
                >
                  复制链接
                </button>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    void copyResourceCurl(resource);
                  }}
                >
                  复制 curl
                </button>
                <button
                  type="button"
                  className="resource-card-btn"
                  onClick={() => {
                    openResourceUrl(resource.url);
                  }}
                >
                  打开
                </button>
              </>
            )}
          </>
        )}
        {canAnalyzeHls ? (
          <>
            <button
              type="button"
              className="resource-card-btn"
              disabled={hlsAnalysis.loading}
              onClick={handleAnalyzeHls}
            >
              {hlsAnalysis.loading ? '解析中' : '解析 HLS'}
            </button>
            {hlsAnalysis.planText ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(hlsAnalysis.planText || '').then(() => {
                    Toast.success('下载计划 JSON 已复制');
                  });
                }}
              >
                复制计划
              </button>
            ) : null}
            {hlsAnalysis.manifest?.keys.length ? (
              <button
                type="button"
                className="resource-card-btn"
                disabled={hlsAnalysis.keyVerificationLoading}
                onClick={handleVerifyHlsKey}
              >
                {hlsAnalysis.keyVerificationLoading ? '验证中' : '验证 key'}
              </button>
            ) : null}
          </>
        ) : null}
        {canAnalyzeMpd ? (
          <>
            <button
              type="button"
              className="resource-card-btn"
              disabled={mpdAnalysis.loading}
              onClick={handleAnalyzeMpd}
            >
              {mpdAnalysis.loading ? '解析中' : '解析 MPD'}
            </button>
            {mpdAnalysis.planText ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(mpdAnalysis.planText || '').then(() => {
                    Toast.success('下载计划 JSON 已复制');
                  });
                }}
              >
                复制计划
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};

const EmbeddedBrowserResourcePanel: React.FC<EmbeddedBrowserResourcePanelProps> = ({
  activeTabId,
  currentPageUrl = '',
}) => {
  const {
    captureEnabled,
    clearResources,
    deepCaptureEnabled,
    loading,
    resources,
    startCapture,
    startDeepCapture,
    stopCapture,
  } = useEmbeddedBrowserResources(activeTabId);
  const catchToolkit = useEmbeddedBrowserCatchToolkit(activeTabId, deepCaptureEnabled);
  const [actionLoading, setActionLoading] = React.useState<'start' | 'deep' | 'stop' | 'clear' | null>(null);
  const [filterDraft, setFilterDraft] = React.useState(loadResourceFilterDraft);

  React.useEffect(() => {
    window.localStorage.setItem(RESOURCE_FILTER_STORAGE_KEY, filterDraft);
  }, [filterDraft]);

  const filterPattern = React.useMemo(() => {
    try {
      return new RegExp(filterDraft, 'i');
    } catch {
      return null;
    }
  }, [filterDraft]);

  const filterError = React.useMemo(() => {
    try {
      new RegExp(filterDraft, 'i');
      return '';
    } catch (error: any) {
      return error?.message || '正则无效';
    }
  }, [filterDraft]);

  const filteredResources = React.useMemo(() => {
    if (filterError) {
      return [];
    }
    return resources.filter((resource) => matchesResourceFilter(resource, filterPattern));
  }, [filterError, filterPattern, resources]);

  const resourceSections = React.useMemo(
    () => createEmbeddedBrowserResourceSections(filteredResources),
    [filteredResources],
  );
  const mergeablePair = React.useMemo(
    () => findMergeableResourcePair(filteredResources),
    [filteredResources],
  );

  const runAction = React.useCallback(async (
    nextAction: 'start' | 'deep' | 'stop' | 'clear',
    runner: () => Promise<unknown>,
    successMessage?: string,
  ) => {
    setActionLoading(nextAction);
    try {
      await runner();
      if (successMessage) {
        Toast.success(successMessage);
      }
    } catch (error: any) {
      Toast.error(error?.message || '资源捕获操作失败');
    } finally {
      setActionLoading(null);
    }
  }, []);

  const disabled = !activeTabId;

  return (
    <PanelShell>
      <div className="resource-panel-header">
        <div className="resource-panel-title-row">
          <h3 className="resource-panel-title">资源捕获</h3>
        </div>
        <p className="resource-panel-subtitle">
          {currentPageUrl
            ? `当前页面：${currentPageUrl}`
            : '选中一个浏览器标签后，可以在这里查看本页捕获到的资源。'}
        </p>
        <div className="resource-panel-badges">
          <span className={`resource-panel-badge ${captureEnabled ? 'is-active' : ''}`}>
            {captureEnabled ? '网络捕获已开启' : '网络捕获未开启'}
          </span>
          <span className={`resource-panel-badge ${deepCaptureEnabled ? 'is-active' : ''}`}>
            {deepCaptureEnabled ? '深度探测已开启' : '深度探测未开启'}
          </span>
          <span className="resource-panel-badge">
            {loading ? '同步中...' : `显示 ${filteredResources.length} / ${resources.length} 条`}
          </span>
        </div>
        <div className="resource-panel-filter">
          <div className="resource-panel-filter-label">
            正则过滤，默认只保留媒体相关资源。
          </div>
          <div className="resource-panel-filter-row">
            <input
              className="resource-panel-filter-input"
              value={filterDraft}
              onChange={(event) => {
                setFilterDraft(event.target.value);
              }}
              placeholder="输入正则，例如 m4s|m3u8|mpd"
            />
            <button
              type="button"
              className="resource-panel-filter-reset"
              onClick={() => {
                setFilterDraft(DEFAULT_MEDIA_RESOURCE_REGEX);
              }}
            >
              重置
            </button>
          </div>
          {filterError ? (
            <div className="resource-panel-filter-error">
              正则解析失败：{filterError}
            </div>
          ) : null}
        </div>
        <div className="resource-panel-actions">
          <button
            type="button"
            className="resource-panel-btn primary"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('start', startCapture, '已开启资源捕获');
            }}
          >
            开启捕获
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('deep', startDeepCapture, '已刷新页面并开启深度探测');
            }}
          >
            深度捕获
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('stop', stopCapture, '已停止资源捕获');
            }}
          >
            停止捕获
          </button>
          <button
            type="button"
            className="resource-panel-btn"
            disabled={disabled || actionLoading !== null}
            onClick={() => {
              void runAction('clear', clearResources, '已清空资源列表');
            }}
            >
              清空列表
            </button>
          {mergeablePair ? (
            <button
              type="button"
              className="resource-panel-btn"
              disabled={disabled || actionLoading !== null}
              onClick={() => {
                void mergeCapturedResources(mergeablePair).catch((error: any) => {
                  Toast.error(error?.message || '合并失败');
                });
              }}
            >
              合并主音视频
            </button>
          ) : null}
        </div>
      </div>
      <div className="resource-panel-body">
        {activeTabId && deepCaptureEnabled ? (
          <EmbeddedBrowserCatchToolkitCard
            disabled={disabled}
            loading={catchToolkit.loading}
            onClearCache={catchToolkit.clearCache}
            onDownloadMedia={catchToolkit.downloadMedia}
            onRestartCapture={catchToolkit.restartCapture}
            onUpdateState={catchToolkit.updateState}
            state={catchToolkit.state}
          />
        ) : null}
        {!activeTabId ? (
          <div className="resource-panel-empty">
            先打开一个内置浏览器标签页，再开始捕获。
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="resource-panel-empty">
            {filterError
              ? '当前正则无效，先修正过滤规则。'
              : captureEnabled
                ? '当前过滤条件下还没有命中资源。可以继续浏览页面，或者点“深度捕获”后刷新页面。'
                : '点击“开启捕获”后，网络层资源会开始进入这个面板。'}
          </div>
        ) : (
          resourceSections.map((section) => (
            <div key={section.key} className="resource-section">
              <div className="resource-section-header">
                <div className="resource-section-title-row">
                  <div className="resource-section-title">{section.title}</div>
                  <div className="resource-section-count">{section.items.length}</div>
                </div>
                <div className="resource-section-description">{section.description}</div>
              </div>
              {section.items.map((resource) => (
                <ResourceCard key={resource.id} resource={resource} resources={filteredResources} />
              ))}
            </div>
          ))
        )}
      </div>
    </PanelShell>
  );
};

export default EmbeddedBrowserResourcePanel;
