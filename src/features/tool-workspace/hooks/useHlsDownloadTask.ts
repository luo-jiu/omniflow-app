import React from 'react';
import { Toast } from '@douyinfe/semi-ui';

import {
  parseHlsManifest as parseEmbeddedBrowserHlsManifest,
} from '../../../../electron/service/embedded-browser/cat-catch-port/hls/parser';
import {
  createHlsDownloadPlan as createEmbeddedBrowserHlsDownloadPlan,
} from '../../../../electron/service/embedded-browser/cat-catch-port/hls/plan';
import {
  applyCatCatchHlsSegmentQueryToPlan as applyEmbeddedBrowserHlsSegmentQuery,
  extractCatCatchHlsSegmentQueryDefault as extractEmbeddedBrowserHlsSegmentQueryDefault,
} from '../../../../electron/service/embedded-browser/cat-catch-port/hls/segment-query';

import {
  verifyHlsResourceKey,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource-panel-actions';
import {
  discardEmbeddedBrowserHlsRecording,
  downloadEmbeddedBrowserDirectFile,
  downloadEmbeddedBrowserHlsManifest,
  startEmbeddedBrowserHlsRecording,
  stopEmbeddedBrowserHlsRecording,
  downloadEmbeddedBrowserHlsTracks,
  downloadEmbeddedBrowserHlsPlan,
  listEmbeddedBrowserCapturedResources,
  listEmbeddedBrowserHlsTaskSnapshots,
  retryEmbeddedBrowserHlsPlanFailed,
  subscribeEmbeddedBrowserHlsTask,
  type EmbeddedBrowserHlsTaskProjection,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource.api';
import { withResourceRefererHeader } from '@/features/embedded-browser/resources/services/embedded-browser-resource-request';
import {
  normalizeHlsKeyCandidateValue,
  type EmbeddedBrowserHlsKeyVerificationResult,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-key-verifier';
import {
  resolveCapturedHlsManifestResourceId,
  resolveCapturedHlsTrackResourceIds,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-resource-authority';
import { selectNewestMatchingHlsTaskProjection } from './hls-task-projection';

import { filterHlsRenditionsForVariant } from '../hls-rendition-groups';
import type { ToolWorkspaceMediaHlsRequest } from '../types';

export type HlsTaskStage = 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'ffmpeg' | 'completed' | 'error';

export type HlsTaskLogEntry = {
  createdAt: number;
  id: string;
  level: 'error' | 'info' | 'success';
  mode?: 'direct-manifest' | 'local-plan';
  stage?: HlsTaskStage;
  text: string;
};

export type HlsTaskStatus = {
  bytesReceived?: number;
  bytesTotal?: number;
  completedFragments: number;
  durationSeconds?: number;
  error?: string;
  etaSeconds?: number;
  ffmpegSpeedText?: string;
  failedFragments?: number[];
  lastOutputPath?: string;
  logs: HlsTaskLogEntry[];
  mode?: 'direct-manifest' | 'local-plan';
  processedSeconds?: number;
  requestId?: string;
  speedBps?: number;
  stage?: HlsTaskStage;
  state: 'idle' | 'running' | 'success' | 'error';
  totalFragments: number;
};

export type HlsLiveRecordingState = 'idle' | 'starting' | 'recording' | 'stopping';

export type HlsVariantOption = {
  label: string;
  value: string;
};

export type HlsRenditionOption = {
  groupId?: string;
  label: string;
  value: string;
};

type UseHlsDownloadTaskInput = {
  createOutputTargetSnapshot?: () => Promise<{
    cleanupOutputDirectory: () => Promise<void>;
    outputDirectoryPath?: string;
    persistOutput: (outputPath: string) => Promise<void>;
  }>;
  hlsRequest: ToolWorkspaceMediaHlsRequest | null;
  onCleanupOutputDirectory?: (outputDirectoryPath: string) => Promise<void>;
  outputDirectoryPath?: string;
  resolveOutputDirectoryPath?: () => Promise<string | undefined>;
  onPersistOutput: (outputPath: string) => Promise<void>;
};

function deriveHlsOutputFileName(url: string) {
  try {
    const fileName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '')
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

function formatHlsVariantLabel(variant: {
  averageBandwidth?: number;
  bandwidth?: number;
  codecs?: string;
  frameRate?: number;
  resolution?: string;
  url: string;
}, index: number) {
  const parts: string[] = [];
  if (variant.resolution) {
    parts.push(variant.resolution);
  }
  const preferredBandwidth = variant.averageBandwidth || variant.bandwidth;
  if (preferredBandwidth && Number.isFinite(preferredBandwidth)) {
    const mbps = preferredBandwidth / 1000 / 1000;
    parts.push(`${mbps >= 1 ? mbps.toFixed(1) : (preferredBandwidth / 1000).toFixed(0)} ${mbps >= 1 ? 'Mbps' : 'Kbps'}`);
  }
  if (variant.codecs) {
    parts.push(variant.codecs);
  }
  if (variant.frameRate && Number.isFinite(variant.frameRate)) {
    parts.push(`${variant.frameRate.toFixed(2)} fps`);
  }
  const title = parts.length ? parts.join(' · ') : `变体 ${index + 1}`;
  return `${title} · ${deriveHlsOutputFileName(variant.url)}`;
}

function formatHlsRenditionOptionLabel(rendition: {
  autoselect?: boolean;
  default?: boolean;
  forced?: boolean;
  groupId?: string;
  language?: string;
  name?: string;
  url?: string;
}, index: number) {
  const parts: string[] = [];
  if (rendition.name) {
    parts.push(rendition.name);
  }
  if (rendition.language) {
    parts.push(rendition.language);
  }
  if (rendition.groupId) {
    parts.push(`group:${rendition.groupId}`);
  }
  if (rendition.default) {
    parts.push('default');
  }
  if (rendition.autoselect) {
    parts.push('autoselect');
  }
  if (rendition.forced) {
    parts.push('forced');
  }
  return parts.join(' · ') || `轨道 ${index + 1}`;
}

function pickDefaultHlsVariant(
  variants: ToolWorkspaceMediaHlsRequest['plan']['variants'],
) {
  if (!variants.length) {
    return null;
  }
  return [...variants].sort((left, right) => (
    Number(right.averageBandwidth || right.bandwidth || 0) - Number(left.averageBandwidth || left.bandwidth || 0)
  ))[0] || variants[0] || null;
}

function createHlsTaskLogEntry(input: {
  level?: HlsTaskLogEntry['level'];
  mode?: HlsTaskLogEntry['mode'];
  stage?: HlsTaskStage;
  text: string;
}) {
  return {
    createdAt: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level: input.level || 'info',
    mode: input.mode,
    stage: input.stage,
    text: input.text,
  } satisfies HlsTaskLogEntry;
}

function appendHlsTaskLogs(logs: HlsTaskLogEntry[], ...entries: HlsTaskLogEntry[]) {
  return [...logs, ...entries].slice(-14);
}

function getHlsTaskProgressPercent(status: HlsTaskStatus) {
  if (status.state === 'success' || status.stage === 'completed') {
    return 100;
  }
  if (status.stage === 'preparing') {
    return 6;
  }
  if (status.stage === 'downloading-fragments') {
    if (status.totalFragments > 0) {
      return Math.max(8, Math.min(82, Math.round((status.completedFragments / status.totalFragments) * 82)));
    }
    return 24;
  }
  if (status.stage === 'rewriting-playlist') {
    return 88;
  }
  if (status.stage === 'ffmpeg') {
    if (status.durationSeconds && status.processedSeconds && status.durationSeconds > 0) {
      const ratio = Math.max(0, Math.min(1, status.processedSeconds / status.durationSeconds));
      return Math.max(90, Math.min(99, Math.round(90 + ratio * 9)));
    }
    return 95;
  }
  if (status.state === 'error') {
    if (status.totalFragments > 0) {
      return Math.max(6, Math.min(95, Math.round((status.completedFragments / status.totalFragments) * 82)));
    }
    return 0;
  }
  return 0;
}

function describeHlsTaskProgress(status: HlsTaskStatus) {
  if (status.state === 'idle') {
    return '等待你发起 HLS 处理任务。';
  }
  if (status.stage === 'downloading-fragments' && status.totalFragments > 0) {
    return `正在拉取分片，已完成 ${Math.min(status.completedFragments, status.totalFragments)} / ${status.totalFragments}。`;
  }
  if (status.stage === 'rewriting-playlist') {
    return '本地分片已经齐了，正在整理成本地播放列表。';
  }
  if (status.stage === 'ffmpeg') {
    if (status.durationSeconds && status.processedSeconds) {
      return `分片准备完成，ffmpeg 正在合成，已处理 ${Math.min(status.processedSeconds, status.durationSeconds).toFixed(1)} / ${status.durationSeconds.toFixed(1)} 秒。`;
    }
    return '分片准备完成，正在交给 ffmpeg 合成最终文件。';
  }
  if (status.state === 'success') {
    return '本次 HLS 任务已经完成，可以直接看产物路径或继续导入。';
  }
  if (status.state === 'error') {
    return '任务中途失败了，可以先看最近日志和错误说明，再决定是否重试。';
  }
  return '任务正在准备阶段。';
}

function clampHlsFragmentRangeValue(value: number, total: number) {
  if (!Number.isFinite(value) || total <= 0) {
    return 1;
  }
  return Math.min(total, Math.max(1, Math.round(value)));
}

function createHlsPlanSlice(
  plan: ToolWorkspaceMediaHlsRequest['plan'],
  input: {
    endFragment: number;
    startFragment: number;
    threadCount: number;
  },
) {
  const totalFragments = plan.fragments.length;
  const startFragment = clampHlsFragmentRangeValue(input.startFragment, totalFragments);
  const endFragment = clampHlsFragmentRangeValue(input.endFragment, totalFragments);
  if (endFragment < startFragment) {
    return {
      error: '结束分片不能早于起始分片',
      ok: false as const,
    };
  }

  const startIndex = startFragment - 1;
  const endIndex = endFragment - 1;
  const selectedFragments = plan.fragments.filter((fragment, index) => {
    const sourceIndex = typeof fragment.index === 'number' ? fragment.index : index;
    return sourceIndex >= startIndex && sourceIndex <= endIndex;
  });
  if (!selectedFragments.length) {
    return {
      error: '当前分片范围内没有可下载的片段',
      ok: false as const,
    };
  }

  const selectedSourceIndexes = new Set(
    selectedFragments.map((fragment, index) => (
      typeof fragment.index === 'number' ? fragment.index : index
    )),
  );
  const selectedSegments = plan.segments.filter((_, index) => selectedSourceIndexes.has(index));
  const durationSeconds = selectedFragments.reduce((total, fragment) => total + Number(fragment.duration || 0), 0);

  return {
    ok: true as const,
    plan: {
      ...plan,
      durationSeconds,
      encryptedSegmentCount: selectedFragments.filter((fragment) => Boolean(fragment.key?.url || fragment.key?.method)).length,
      fragmentCount: selectedFragments.length,
      fragments: selectedFragments,
      partCount: selectedFragments.filter((fragment) => fragment.part).length,
      segmentCount: selectedSegments.length,
      segments: selectedSegments,
      suggestedThreadCount: Math.max(1, Math.round(input.threadCount)),
    },
  };
}

async function resolveMasterVariantToMediaPlan(input: {
  headers: Record<string, string>;
  pageUrl?: string;
  parentVariableList?: Readonly<Record<string, string>>;
  segmentQuery: string | null;
  variantManifestUrl: string;
}) {
  const response = await window.electronAPI.fetch(input.variantManifestUrl, { headers: input.headers });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`变体 playlist 请求失败：HTTP ${response.status}`);
  }
  const text = typeof response.body === 'string'
    ? response.body
    : JSON.stringify(response.body || '');
  if (!text.includes('#EXTM3U')) {
    throw new Error('当前变体返回的内容不像 HLS playlist');
  }
  const manifest = parseEmbeddedBrowserHlsManifest({
    baseUrl: input.variantManifestUrl,
    parentVariableList: input.parentVariableList,
    text,
  });
  const plan = createEmbeddedBrowserHlsDownloadPlan({
    headers: input.headers,
    manifest,
    manifestUrl: input.variantManifestUrl,
    pageUrl: input.pageUrl,
    segmentQuery: input.segmentQuery,
  });
  if (plan.isMaster) {
    throw new Error('当前选择的变体仍然是 master playlist，先换一个具体媒体变体再试');
  }
  if (!plan.fragmentCount) {
    throw new Error('当前变体没有可下载分片');
  }
  return {
    manifest,
    plan,
  };
}

export function useHlsDownloadTask(input: UseHlsDownloadTaskInput) {
  const {
    createOutputTargetSnapshot,
    hlsRequest,
    onCleanupOutputDirectory,
    onPersistOutput,
    outputDirectoryPath,
    resolveOutputDirectoryPath,
  } = input;
  const [savingHls, setSavingHls] = React.useState(false);
  const [verifyingHlsKey, setVerifyingHlsKey] = React.useState(false);
  const [hlsManualKeyDraft, setHlsManualKeyDraft] = React.useState('');
  const [hlsSegmentQueryDraft, setHlsSegmentQueryDraft] = React.useState('');
  const [hlsSegmentQueryEnabled, setHlsSegmentQueryEnabled] = React.useState(false);
  const [selectedHlsVariantUrl, setSelectedHlsVariantUrl] = React.useState('');
  const [selectedHlsAudioRenditionUrl, setSelectedHlsAudioRenditionUrl] = React.useState('');
  const [selectedHlsSubtitleRenditionUrl, setSelectedHlsSubtitleRenditionUrl] = React.useState('');
  const [hlsThreadCountDraft, setHlsThreadCountDraft] = React.useState(6);
  const [hlsRangeStartDraft, setHlsRangeStartDraft] = React.useState(1);
  const [hlsRangeEndDraft, setHlsRangeEndDraft] = React.useState(1);
  const [hlsKeyVerificationResult, setHlsKeyVerificationResult] = React.useState<EmbeddedBrowserHlsKeyVerificationResult | null>(null);
  const [hlsLiveRecordingState, setHlsLiveRecordingState] = React.useState<HlsLiveRecordingState>('idle');
  const [hlsTaskStatus, setHlsTaskStatus] = React.useState<HlsTaskStatus>({
    bytesReceived: undefined,
    bytesTotal: undefined,
    completedFragments: 0,
    durationSeconds: undefined,
    etaSeconds: undefined,
    ffmpegSpeedText: undefined,
    logs: [],
    processedSeconds: undefined,
    state: 'idle',
    speedBps: undefined,
    totalFragments: 0,
  });
  const activeHlsTaskRequestIdRef = React.useRef('');
  const activeHlsTaskManifestUrlRef = React.useRef('');
  const activeHlsTaskRevisionRef = React.useRef(0);
  const activeHlsKeyVerificationTokenRef = React.useRef('');
  const hlsLiveRecordingStateRef = React.useRef<HlsLiveRecordingState>('idle');
  const hlsTaskStateRef = React.useRef<HlsTaskStatus['state']>('idle');
  const hlsOutputTargetRef = React.useRef<null | {
    cleanupOutputDirectory: () => Promise<void>;
    persistOutput: (outputPath: string) => Promise<void>;
    requestId: string;
  }>(null);

  const normalizedHlsManualKey = React.useMemo(() => (
    normalizeHlsKeyCandidateValue(hlsManualKeyDraft) || ''
  ), [hlsManualKeyDraft]);
  const hlsManualKeyInputMode = React.useMemo(() => {
    const normalizedDraft = String(hlsManualKeyDraft || '').trim();
    if (!normalizedDraft) {
      return '';
    }
    return /^(?:0x)?[0-9a-f]{32}$/i.test(normalizedDraft) ? 'hex' : 'base64';
  }, [hlsManualKeyDraft]);
  const hlsManualKeyInvalid = Boolean(String(hlsManualKeyDraft || '').trim()) && !normalizedHlsManualKey;
  const hlsSegmentQuery = hlsSegmentQueryEnabled ? hlsSegmentQueryDraft : null;
  const hlsAes128KeyCount = React.useMemo(() => (
    hlsRequest?.plan.keys.filter((key) => String(key.method || '').toUpperCase() === 'AES-128').length || 0
  ), [hlsRequest]);
  const hlsNonAesKeyCount = React.useMemo(() => (
    hlsRequest?.plan.keys.filter((key) => String(key.method || '').toUpperCase() !== 'AES-128').length || 0
  ), [hlsRequest]);
  const hlsVariantOptions = React.useMemo<HlsVariantOption[]>(() => {
    if (!hlsRequest?.plan.variants.length) {
      return [];
    }
    return hlsRequest.plan.variants.map((variant, index) => ({
      label: formatHlsVariantLabel(variant, index),
      value: variant.url,
    }));
  }, [hlsRequest]);
  const hlsSelectedVariantLabel = React.useMemo(() => {
    if (!selectedHlsVariantUrl) {
      return '';
    }
    return hlsVariantOptions.find((option) => option.value === selectedHlsVariantUrl)?.label || '';
  }, [hlsVariantOptions, selectedHlsVariantUrl]);
  const hlsAudioRenditions = React.useMemo(() => (
    (hlsRequest?.plan.renditions || []).filter((rendition) => String(rendition.type || '').toUpperCase() === 'AUDIO')
  ), [hlsRequest]);
  const hlsSubtitleRenditions = React.useMemo(() => (
    (hlsRequest?.plan.renditions || []).filter((rendition) => String(rendition.type || '').toUpperCase() === 'SUBTITLES')
  ), [hlsRequest]);
  const hlsDefaultVariant = React.useMemo(() => (
    pickDefaultHlsVariant(hlsRequest?.plan.variants || [])
  ), [hlsRequest]);
  const hlsSelectedVariant = React.useMemo(() => {
    if (!selectedHlsVariantUrl) {
      return null;
    }
    return hlsRequest?.plan.variants.find((variant) => variant.url === selectedHlsVariantUrl) || null;
  }, [hlsRequest, selectedHlsVariantUrl]);
  const hlsEffectiveVariant = hlsSelectedVariant || hlsDefaultVariant;
  const hlsAudioRenditionOptions = React.useMemo<HlsRenditionOption[]>(() => (
    filterHlsRenditionsForVariant(hlsAudioRenditions, hlsEffectiveVariant, 'AUDIO')
      .filter((rendition) => Boolean(rendition.url))
      .map((rendition, index) => ({
        groupId: rendition.groupId,
        label: formatHlsRenditionOptionLabel(rendition, index),
        value: String(rendition.url || ''),
      }))
  ), [hlsAudioRenditions, hlsEffectiveVariant]);
  const hlsSubtitleRenditionOptions = React.useMemo<HlsRenditionOption[]>(() => (
    filterHlsRenditionsForVariant(hlsSubtitleRenditions, hlsEffectiveVariant, 'SUBTITLES')
      .filter((rendition) => Boolean(rendition.url))
      .map((rendition, index) => ({
        groupId: rendition.groupId,
        label: formatHlsRenditionOptionLabel(rendition, index),
        value: String(rendition.url || ''),
      }))
  ), [hlsEffectiveVariant, hlsSubtitleRenditions]);
  const hlsSelectedAudioRendition = React.useMemo(() => (
    hlsAudioRenditions.find((rendition) => rendition.url === selectedHlsAudioRenditionUrl) || null
  ), [hlsAudioRenditions, selectedHlsAudioRenditionUrl]);
  const hlsSelectedSubtitleRendition = React.useMemo(() => (
    hlsSubtitleRenditions.find((rendition) => rendition.url === selectedHlsSubtitleRenditionUrl) || null
  ), [hlsSubtitleRenditions, selectedHlsSubtitleRenditionUrl]);
  const hlsTaskManifestUrls = React.useMemo(() => Array.from(new Set([
    hlsRequest?.plan.manifestUrl,
    ...(hlsRequest?.plan.variants || []).map(variant => variant.url),
    ...(hlsRequest?.plan.renditions || []).map(rendition => rendition.url),
  ].map(value => String(value || '').trim()).filter(Boolean))), [hlsRequest]);
  const hlsCanSelectVariant = Boolean(
    hlsRequest?.plan.isMaster
    && /^https?:\/\//i.test(hlsRequest?.plan.manifestUrl || '')
    && hlsVariantOptions.length > 0,
  );
  const hlsCanTuneLocalDownloader = Boolean(hlsRequest && !hlsRequest.plan.isMaster && hlsRequest.plan.fragmentCount > 0);
  const normalizedHlsThreadCount = Math.max(1, Math.round(Number(hlsThreadCountDraft || 0) || 0));
  const normalizedHlsRangeStart = hlsRequest?.plan.fragmentCount
    ? clampHlsFragmentRangeValue(hlsRangeStartDraft, hlsRequest.plan.fragmentCount)
    : 1;
  const normalizedHlsRangeEnd = hlsRequest?.plan.fragmentCount
    ? clampHlsFragmentRangeValue(hlsRangeEndDraft, hlsRequest.plan.fragmentCount)
    : 1;
  const hlsUsingCustomThreadCount = Boolean(
    hlsCanTuneLocalDownloader
    && normalizedHlsThreadCount !== Math.max(1, hlsRequest?.plan.suggestedThreadCount || 6),
  );
  const hlsUsingFragmentRange = Boolean(
    hlsCanTuneLocalDownloader
    && (
      normalizedHlsRangeStart !== 1
      || normalizedHlsRangeEnd !== Math.max(1, hlsRequest?.plan.fragmentCount || 1)
    ),
  );
  const hlsTaskProgressPercent = React.useMemo(() => (
    getHlsTaskProgressPercent(hlsTaskStatus)
  ), [hlsTaskStatus]);
  const hlsTaskProgressSummary = React.useMemo(() => (
    describeHlsTaskProgress(hlsTaskStatus)
  ), [hlsTaskStatus]);

  React.useEffect(() => {
    hlsLiveRecordingStateRef.current = hlsLiveRecordingState;
  }, [hlsLiveRecordingState]);

  React.useEffect(() => {
    hlsTaskStateRef.current = hlsTaskStatus.state;
  }, [hlsTaskStatus.state]);

  React.useEffect(() => {
    const previousRequest = hlsRequest;
    return () => {
      const requestId = activeHlsTaskRequestIdRef.current;
      const liveState = hlsLiveRecordingStateRef.current;
      const shouldDiscardLiveSession = (
        previousRequest?.plan.isLive
        && (
          liveState === 'recording'
          || liveState === 'starting'
          || (liveState === 'idle' && hlsTaskStateRef.current === 'error')
        )
      );
      if (!previousRequest || !requestId || !shouldDiscardLiveSession) {
        return;
      }
      const outputTarget = hlsOutputTargetRef.current?.requestId === requestId
        ? hlsOutputTargetRef.current
        : null;
      void discardEmbeddedBrowserHlsRecording(previousRequest.resource.tabId, {
        requestId,
      })
        .catch(() => undefined)
        .finally(async () => {
          await outputTarget?.cleanupOutputDirectory().catch(() => undefined);
          if (activeHlsTaskRequestIdRef.current === requestId) {
            activeHlsTaskRequestIdRef.current = '';
            activeHlsTaskManifestUrlRef.current = '';
            hlsOutputTargetRef.current = null;
          }
        });
    };
  }, [hlsRequest]);

  React.useEffect(() => {
    setHlsManualKeyDraft('');
    setHlsSegmentQueryDraft(extractEmbeddedBrowserHlsSegmentQueryDefault(hlsRequest?.plan.manifestUrl || '') || '');
    setHlsSegmentQueryEnabled(false);
    setSelectedHlsVariantUrl('');
    setSelectedHlsAudioRenditionUrl('');
    setSelectedHlsSubtitleRenditionUrl('');
    setHlsThreadCountDraft(Math.max(1, hlsRequest?.plan.suggestedThreadCount || 6));
    setHlsRangeStartDraft(1);
    setHlsRangeEndDraft(Math.max(1, hlsRequest?.plan.fragmentCount || 1));
    setHlsKeyVerificationResult(null);
    setVerifyingHlsKey(false);
    setHlsLiveRecordingState('idle');
    activeHlsTaskRequestIdRef.current = '';
    activeHlsTaskManifestUrlRef.current = '';
    activeHlsTaskRevisionRef.current = 0;
    activeHlsKeyVerificationTokenRef.current = '';
    hlsOutputTargetRef.current = null;
    setHlsTaskStatus({
      bytesReceived: undefined,
      bytesTotal: undefined,
      completedFragments: 0,
      durationSeconds: hlsRequest?.plan.durationSeconds || undefined,
      etaSeconds: undefined,
      ffmpegSpeedText: undefined,
      logs: [],
      processedSeconds: undefined,
      state: 'idle',
      speedBps: undefined,
      totalFragments: hlsRequest?.plan.fragmentCount || 0,
    });
  }, [hlsRequest?.id, hlsRequest?.plan.durationSeconds, hlsRequest?.plan.fragmentCount, hlsRequest?.plan.manifestUrl, hlsRequest?.plan.suggestedThreadCount]);

  React.useEffect(() => {
    if (selectedHlsAudioRenditionUrl && !hlsAudioRenditionOptions.some((option) => option.value === selectedHlsAudioRenditionUrl)) {
      setSelectedHlsAudioRenditionUrl('');
    }
    if (selectedHlsSubtitleRenditionUrl && !hlsSubtitleRenditionOptions.some((option) => option.value === selectedHlsSubtitleRenditionUrl)) {
      setSelectedHlsSubtitleRenditionUrl('');
    }
  }, [
    hlsAudioRenditionOptions,
    hlsSubtitleRenditionOptions,
    selectedHlsAudioRenditionUrl,
    selectedHlsSubtitleRenditionUrl,
  ]);

  React.useEffect(() => {
    if (!hlsRequest) {
      return;
    }
    setHlsKeyVerificationResult(null);
    activeHlsKeyVerificationTokenRef.current = '';
    setVerifyingHlsKey(false);
  }, [hlsManualKeyDraft, selectedHlsVariantUrl, hlsRequest]);

  React.useEffect(() => {
    if (!hlsRequest) {
      return;
    }
    let disposed = false;
    const applyProjection = (candidate: EmbeddedBrowserHlsTaskProjection) => {
      if (hlsRequest.plan.isLive && !activeHlsTaskRequestIdRef.current) {
        return;
      }
      const payload = selectNewestMatchingHlsTaskProjection([candidate], {
        afterRevision: activeHlsTaskRevisionRef.current,
        manifestUrls: hlsTaskManifestUrls,
        requestId: activeHlsTaskRequestIdRef.current || undefined,
        tabId: hlsRequest.resource.tabId,
      });
      if (!payload) {
        return;
      }
      activeHlsTaskRevisionRef.current = payload.revision;
      if (!activeHlsTaskRequestIdRef.current && payload.requestId) {
        activeHlsTaskRequestIdRef.current = payload.requestId;
        activeHlsTaskManifestUrlRef.current = payload.manifestUrl;
      }
      if (hlsRequest.plan.isLive && payload.requestId === activeHlsTaskRequestIdRef.current) {
        if (payload.status !== 'running') {
          setHlsLiveRecordingState('idle');
        } else if (payload.stage === 'preparing') {
          setHlsLiveRecordingState('starting');
        } else if (payload.stage === 'rewriting-playlist' || payload.stage === 'ffmpeg') {
          setHlsLiveRecordingState('stopping');
        } else {
          setHlsLiveRecordingState('recording');
        }
      }
      setHlsTaskStatus((previous) => {
        const nextLog = payload.message
          ? appendHlsTaskLogs(
            previous.logs,
            createHlsTaskLogEntry({
              level: payload.status === 'error' ? 'error' : payload.status === 'success' ? 'success' : 'info',
              mode: payload.mode,
              stage: payload.stage,
              text: payload.message,
            }),
          )
          : previous.logs;
        return {
          bytesReceived: payload.bytesReceived ?? (payload.status === 'running' ? previous.bytesReceived : undefined),
          bytesTotal: payload.bytesTotal ?? (payload.status === 'running' ? previous.bytesTotal : undefined),
          completedFragments: payload.completedFragments ?? previous.completedFragments,
          durationSeconds: payload.durationSeconds ?? previous.durationSeconds,
          error: payload.status === 'error' ? payload.error : undefined,
          etaSeconds: payload.etaSeconds ?? (payload.status === 'running' ? previous.etaSeconds : undefined),
          ffmpegSpeedText: payload.ffmpegSpeedText ?? (payload.stage === 'ffmpeg' && payload.status === 'running' ? previous.ffmpegSpeedText : undefined),
          failedFragments: payload.status === 'error'
            ? (payload.failedFragments ?? previous.failedFragments)
            : (payload.failedFragments ?? undefined),
          lastOutputPath: payload.outputPath || previous.lastOutputPath,
          logs: nextLog,
          mode: payload.mode,
          processedSeconds: payload.processedSeconds ?? (payload.stage === 'ffmpeg' && payload.status === 'running' ? previous.processedSeconds : undefined),
          requestId: payload.requestId || previous.requestId,
          speedBps: payload.speedBps ?? (payload.status === 'running' ? previous.speedBps : undefined),
          stage: payload.stage,
          state: payload.status === 'running'
            ? 'running'
            : payload.status === 'success'
              ? 'success'
              : 'error',
          totalFragments: payload.totalFragments ?? previous.totalFragments,
        };
      });
    };
    const unsubscribe = subscribeEmbeddedBrowserHlsTask(applyProjection);
    void listEmbeddedBrowserHlsTaskSnapshots(hlsRequest.resource.tabId)
      .then((snapshots) => {
        if (disposed) {
          return;
        }
        const snapshot = selectNewestMatchingHlsTaskProjection(snapshots, {
          afterRevision: activeHlsTaskRevisionRef.current,
          manifestUrls: hlsTaskManifestUrls,
          requestId: activeHlsTaskRequestIdRef.current || undefined,
          tabId: hlsRequest.resource.tabId,
        });
        if (snapshot) {
          applyProjection(snapshot);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [hlsRequest, hlsTaskManifestUrls]);

  const handleSaveHls = React.useCallback(async () => {
    if (!hlsRequest) {
      Toast.warning('先从资源面板解析 HLS，再送到工具页');
      return;
    }
    if (hlsRequest.plan.isLive) {
      Toast.warning('直播流先用“开始录制 / 停止录制”，再导出最终文件');
      return;
    }
    if (hlsManualKeyInvalid) {
      Toast.warning('自定义 key 需要是 16 字节 AES-128，支持 hex 或 base64');
      return;
    }
    if (selectedHlsAudioRenditionUrl && (normalizedHlsManualKey || hlsUsingCustomThreadCount || hlsUsingFragmentRange)) {
      Toast.warning('独立音轨合并不和手动 key、线程或分片范围控制混用');
      return;
    }
    const shouldUseLocalPlanForControls = (!selectedHlsAudioRenditionUrl && hlsSegmentQueryEnabled)
      || (hlsCanTuneLocalDownloader && (hlsUsingCustomThreadCount || hlsUsingFragmentRange));
    let effectivePlan = applyEmbeddedBrowserHlsSegmentQuery(hlsRequest.plan, hlsSegmentQuery);
    if (hlsCanTuneLocalDownloader && (hlsUsingCustomThreadCount || hlsUsingFragmentRange)) {
      const slicedPlanResult = createHlsPlanSlice(effectivePlan, {
        endFragment: normalizedHlsRangeEnd,
        startFragment: normalizedHlsRangeStart,
        threadCount: normalizedHlsThreadCount,
      });
      if (!slicedPlanResult.ok) {
        Toast.warning(slicedPlanResult.error);
        return;
      }
      effectivePlan = slicedPlanResult.plan;
    }
    const shouldResolveMasterVariantToLocalPlan = Boolean(
      hlsRequest.plan.isMaster
      && (normalizedHlsManualKey || hlsSegmentQueryEnabled)
      && !selectedHlsAudioRenditionUrl
      && selectedHlsVariantUrl
      && /^https?:\/\//i.test(selectedHlsVariantUrl),
    );
    if (hlsRequest.plan.isMaster && (normalizedHlsManualKey || hlsSegmentQueryEnabled) && !selectedHlsAudioRenditionUrl && !shouldResolveMasterVariantToLocalPlan) {
      Toast.warning('master playlist 使用本地下载控制时，先明确选择一个具体变体');
      return;
    }
    setSavingHls(true);
    let outputProduced = false;
    let outputTarget: {
      cleanupOutputDirectory: () => Promise<void>;
      outputDirectoryPath?: string;
      persistOutput: (outputPath: string) => Promise<void>;
    } | null = null;
    let taskOutputDirectoryPath: string | undefined;
    try {
      const requestId = `hls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resourceHeaders = withResourceRefererHeader(hlsRequest.resource);
      let effectiveManifestUrl = selectedHlsVariantUrl || hlsRequest.plan.manifestUrl;
      let effectiveVideoManifestUrl = selectedHlsVariantUrl || hlsEffectiveVariant?.url || hlsRequest.plan.manifestUrl;
      if (shouldResolveMasterVariantToLocalPlan) {
        const resolvedVariant = await resolveMasterVariantToMediaPlan({
          headers: resourceHeaders,
          pageUrl: undefined,
          parentVariableList: hlsRequest.manifest.variableList,
          segmentQuery: hlsSegmentQuery,
          variantManifestUrl: selectedHlsVariantUrl,
        });
        effectivePlan = resolvedVariant.plan;
        effectiveManifestUrl = resolvedVariant.plan.manifestUrl;
        effectiveVideoManifestUrl = resolvedVariant.plan.manifestUrl;
      }
      const shouldUseManifestTrackMerge = Boolean(
        selectedHlsAudioRenditionUrl
        && /^https?:\/\//i.test(effectiveVideoManifestUrl)
        && /^https?:\/\//i.test(selectedHlsAudioRenditionUrl)
        && !normalizedHlsManualKey
        && !shouldUseLocalPlanForControls
      );
      const shouldUseLocalTrackPlan = shouldUseManifestTrackMerge && hlsSegmentQueryEnabled;
      const shouldUseDirectManifestDownload = /^https?:\/\//i.test(effectiveManifestUrl)
        && !normalizedHlsManualKey
        && !shouldUseLocalPlanForControls
        && !shouldUseManifestTrackMerge;
      const taskMode = shouldUseDirectManifestDownload || (shouldUseManifestTrackMerge && !shouldUseLocalTrackPlan)
        ? 'direct-manifest'
        : 'local-plan';
      let directManifestResourceId: string | null = null;
      let directTrackResourceIds: {
        audioResourceId: string;
        videoResourceId: string;
      } | null = null;
      if (shouldUseDirectManifestDownload || shouldUseManifestTrackMerge) {
        const snapshot = await listEmbeddedBrowserCapturedResources(hlsRequest.resource.tabId);
        directManifestResourceId = shouldUseDirectManifestDownload
          ? resolveCapturedHlsManifestResourceId(
            snapshot,
            hlsRequest.resource.tabId,
            effectiveManifestUrl,
          )
          : null;
        directTrackResourceIds = shouldUseManifestTrackMerge
          ? resolveCapturedHlsTrackResourceIds(snapshot, {
            audioManifestUrl: selectedHlsAudioRenditionUrl,
            tabId: hlsRequest.resource.tabId,
            videoManifestUrl: effectiveVideoManifestUrl,
          })
          : null;
        if (
          (shouldUseDirectManifestDownload && !directManifestResourceId)
          || (shouldUseManifestTrackMerge && !directTrackResourceIds)
        ) {
          throw new Error('所选 HLS manifest 尚未被当前页面捕捉，请先在网页中播放对应清晰度或音轨后重试');
        }
      }
      activeHlsTaskRequestIdRef.current = requestId;
      activeHlsTaskManifestUrlRef.current = selectedHlsAudioRenditionUrl ? effectiveVideoManifestUrl : effectiveManifestUrl;
      setHlsTaskStatus({
        bytesReceived: undefined,
        bytesTotal: undefined,
        completedFragments: 0,
        durationSeconds: effectivePlan.durationSeconds,
        error: undefined,
        etaSeconds: undefined,
        ffmpegSpeedText: undefined,
        failedFragments: undefined,
        lastOutputPath: undefined,
        logs: [
          createHlsTaskLogEntry({
            mode: taskMode,
            stage: 'preparing',
            text: '已创建 HLS 处理任务',
          }),
          createHlsTaskLogEntry({
            mode: taskMode,
            stage: 'preparing',
            text: selectedHlsVariantUrl ? `已选择变体：${hlsSelectedVariantLabel || selectedHlsVariantUrl}` : '当前使用自动变体策略',
          }),
          ...(shouldUseManifestTrackMerge ? [createHlsTaskLogEntry({
            mode: taskMode,
            stage: 'preparing',
            text: `已选择独立音轨：${hlsSelectedAudioRendition?.name || hlsSelectedAudioRendition?.language || selectedHlsAudioRenditionUrl}`,
          })] : []),
          ...(shouldUseLocalPlanForControls || shouldUseLocalTrackPlan ? [createHlsTaskLogEntry({
            mode: 'local-plan',
            stage: 'preparing',
            text: hlsSegmentQueryEnabled
              ? '已启用分片参数替换'
              : `使用下载控制：线程 ${normalizedHlsThreadCount}，分片 #${normalizedHlsRangeStart}-#${normalizedHlsRangeEnd}`,
          })] : []),
        ],
        mode: taskMode,
        processedSeconds: undefined,
        requestId,
        speedBps: undefined,
        stage: 'preparing',
        state: 'running',
        totalFragments: effectivePlan.fragmentCount,
      });
      outputTarget = createOutputTargetSnapshot
        ? await createOutputTargetSnapshot()
        : {
          cleanupOutputDirectory: async () => {
            if (taskOutputDirectoryPath) {
              await onCleanupOutputDirectory?.(taskOutputDirectoryPath);
            }
          },
          outputDirectoryPath: await (resolveOutputDirectoryPath?.() ?? Promise.resolve(outputDirectoryPath)),
          persistOutput: onPersistOutput,
        };
      taskOutputDirectoryPath = outputTarget.outputDirectoryPath;
      hlsOutputTargetRef.current = {
        cleanupOutputDirectory: outputTarget.cleanupOutputDirectory,
        persistOutput: outputTarget.persistOutput,
        requestId,
      };
      const result = shouldUseManifestTrackMerge
        ? await downloadEmbeddedBrowserHlsTracks(hlsRequest.resource.tabId, {
            audioResourceId: directTrackResourceIds!.audioResourceId,
            durationSeconds: effectivePlan.durationSeconds,
            outputDirectoryPath: taskOutputDirectoryPath,
            requestId,
            segmentQuery: hlsSegmentQuery ?? undefined,
            sourceResourceId: hlsRequest.resource.id,
            suggestedFileName: deriveHlsOutputFileName(effectiveVideoManifestUrl),
            useSystemSaveDialog: false,
            videoResourceId: directTrackResourceIds!.videoResourceId,
          })
        : shouldUseDirectManifestDownload
          ? await downloadEmbeddedBrowserHlsManifest(hlsRequest.resource.tabId, {
            durationSeconds: effectivePlan.durationSeconds,
            outputDirectoryPath: taskOutputDirectoryPath,
            resourceId: directManifestResourceId!,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
            useSystemSaveDialog: false,
          })
          : await downloadEmbeddedBrowserHlsPlan(hlsRequest.resource.tabId, {
            manualKeyBase64: normalizedHlsManualKey || undefined,
            outputDirectoryPath: taskOutputDirectoryPath,
            plan: effectivePlan,
            resourceId: hlsRequest.resource.id,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
            useSystemSaveDialog: false,
          });
      if (result?.cancelled) {
        await outputTarget.cleanupOutputDirectory();
        setHlsTaskStatus((previous) => ({
          ...previous,
          logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
            level: 'info',
            mode: previous.mode,
            stage: previous.stage,
            text: '任务已取消',
          })),
          state: 'idle',
        }));
        hlsOutputTargetRef.current = null;
        return;
      }
      if (!result?.outputPath) {
        throw new Error('HLS 下载已完成，但未返回输出路径');
      }
      outputProduced = true;
      await outputTarget.persistOutput(result.outputPath);
      hlsOutputTargetRef.current = null;
    } catch (error: any) {
      if (outputTarget && !outputProduced) {
        await outputTarget.cleanupOutputDirectory();
        hlsOutputTargetRef.current = null;
      }
      setHlsTaskStatus((previous) => ({
        ...previous,
        bytesReceived: undefined,
        bytesTotal: undefined,
        error: error?.message || 'HLS 下载失败',
        etaSeconds: undefined,
        ffmpegSpeedText: undefined,
        logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
          level: 'error',
          mode: previous.mode,
          stage: 'error',
          text: error?.message || 'HLS 下载失败',
        })),
        processedSeconds: undefined,
        stage: 'error',
        state: 'error',
        speedBps: undefined,
      }));
      Toast.error(error?.message || 'HLS 下载失败');
    } finally {
      setSavingHls(false);
    }
  }, [
    hlsCanTuneLocalDownloader,
    hlsEffectiveVariant,
    hlsManualKeyInvalid,
    hlsRequest,
    hlsSegmentQuery,
    hlsSegmentQueryEnabled,
    hlsSelectedAudioRendition,
    hlsSelectedVariantLabel,
    hlsUsingCustomThreadCount,
    hlsUsingFragmentRange,
    normalizedHlsManualKey,
    normalizedHlsRangeEnd,
    normalizedHlsRangeStart,
    normalizedHlsThreadCount,
    createOutputTargetSnapshot,
    onCleanupOutputDirectory,
    onPersistOutput,
    outputDirectoryPath,
    resolveOutputDirectoryPath,
    selectedHlsAudioRenditionUrl,
    selectedHlsVariantUrl,
  ]);

  const handleDownloadSelectedSubtitle = React.useCallback(async () => {
    if (!hlsRequest || !selectedHlsSubtitleRenditionUrl) {
      Toast.warning('先选择一条字幕轨');
      return;
    }
    try {
      const result = await downloadEmbeddedBrowserDirectFile(hlsRequest.resource.tabId, {
        headers: withResourceRefererHeader(hlsRequest.resource),
        outputDirectoryPath,
        suggestedFileName: deriveHlsOutputFileName(selectedHlsSubtitleRenditionUrl).replace(/\.mp4$/i, '.vtt'),
        url: selectedHlsSubtitleRenditionUrl,
        useSystemSaveDialog: false,
      });
      if (result?.cancelled) {
        return;
      }
      if (!result?.outputPath) {
        throw new Error('字幕下载已完成，但未返回输出路径');
      }
      Toast.success('字幕轨已保存到本地');
    } catch (error: any) {
      Toast.error(error?.message || '字幕轨下载失败');
    }
  }, [hlsRequest, outputDirectoryPath, selectedHlsSubtitleRenditionUrl]);

  const handleRetryFailedHls = React.useCallback(async () => {
    if (!hlsRequest) {
      Toast.warning('先从资源面板解析 HLS，再送到工具页');
      return;
    }
    if (hlsTaskStatus.mode !== 'local-plan' || hlsTaskStatus.state !== 'error' || !hlsTaskStatus.requestId) {
      void handleSaveHls();
      return;
    }
    if (!hlsTaskStatus.failedFragments?.length) {
      void handleSaveHls();
      return;
    }

    setSavingHls(true);
    try {
      activeHlsTaskRequestIdRef.current = hlsTaskStatus.requestId;
      activeHlsTaskManifestUrlRef.current = hlsRequest.plan.manifestUrl;
      setHlsTaskStatus((previous) => ({
        ...previous,
        error: undefined,
        ffmpegSpeedText: undefined,
        logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
          level: 'info',
          mode: 'local-plan',
          stage: 'downloading-fragments',
          text: `开始重试 ${previous.failedFragments?.length || 0} 个失败分片`,
        })),
        processedSeconds: undefined,
        stage: 'downloading-fragments',
        state: 'running',
      }));

      const result = await retryEmbeddedBrowserHlsPlanFailed(hlsRequest.resource.tabId, {
        requestId: hlsTaskStatus.requestId,
      });
      if (result?.cancelled) {
        return;
      }
      if (!result?.outputPath) {
        throw new Error('HLS 重试已完成，但未返回输出路径');
      }
      const outputTarget = hlsOutputTargetRef.current?.requestId === hlsTaskStatus.requestId
        ? hlsOutputTargetRef.current
        : null;
      await (outputTarget?.persistOutput || onPersistOutput)(result.outputPath);
      hlsOutputTargetRef.current = null;
    } catch (error: any) {
      setHlsTaskStatus((previous) => ({
        ...previous,
        bytesReceived: undefined,
        bytesTotal: undefined,
        error: error?.message || 'HLS 重试失败',
        etaSeconds: undefined,
        ffmpegSpeedText: undefined,
        logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
          level: 'error',
          mode: previous.mode,
          stage: 'error',
          text: error?.message || 'HLS 重试失败',
        })),
        processedSeconds: undefined,
        stage: 'error',
        state: 'error',
        speedBps: undefined,
      }));
      Toast.error(error?.message || 'HLS 重试失败');
    } finally {
      setSavingHls(false);
    }
  }, [handleSaveHls, hlsRequest, hlsTaskStatus, onPersistOutput]);

  const handleStartLiveRecording = React.useCallback(async () => {
    if (!hlsRequest) {
      Toast.warning('先从资源面板解析 HLS，再送到工具页');
      return;
    }
    if (!hlsRequest.plan.isLive) {
      Toast.warning('当前不是直播 HLS，直接用“下载&保存”即可');
      return;
    }
    if (hlsManualKeyInvalid) {
      Toast.warning('自定义 key 需要是 16 字节 AES-128，支持 hex 或 base64');
      return;
    }
    if (selectedHlsAudioRenditionUrl) {
      Toast.warning('直播录制第一版先不混用独立音轨选择，先录主视频流');
      return;
    }

    let effectiveManifestUrl = selectedHlsVariantUrl || hlsRequest.plan.manifestUrl;
    if (hlsRequest.plan.isMaster) {
      if (!selectedHlsVariantUrl || !/^https?:\/\//i.test(selectedHlsVariantUrl)) {
        Toast.warning('直播 master playlist 先明确选择一个具体变体');
        return;
      }
      effectiveManifestUrl = selectedHlsVariantUrl;
    }

    setSavingHls(true);
    setHlsLiveRecordingState('starting');
    const previousActiveRequestId = activeHlsTaskRequestIdRef.current;
    const previousActiveManifestUrl = activeHlsTaskManifestUrlRef.current;
    const previousTaskStatus = hlsTaskStatus;
    const previousLiveState = hlsLiveRecordingStateRef.current;
    const previousOutputTarget = hlsOutputTargetRef.current;
    let outputTarget: {
      cleanupOutputDirectory: () => Promise<void>;
      outputDirectoryPath?: string;
      persistOutput: (outputPath: string) => Promise<void>;
    } | null = null;
    try {
      const requestId = `hls-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeHlsTaskRequestIdRef.current = requestId;
      activeHlsTaskManifestUrlRef.current = effectiveManifestUrl;
      setHlsTaskStatus({
        bytesReceived: undefined,
        bytesTotal: undefined,
        completedFragments: 0,
        durationSeconds: undefined,
        error: undefined,
        etaSeconds: undefined,
        ffmpegSpeedText: undefined,
        failedFragments: undefined,
        lastOutputPath: undefined,
        logs: [
          createHlsTaskLogEntry({
            mode: 'local-plan',
            stage: 'preparing',
            text: '已创建直播录制任务',
          }),
          ...(selectedHlsVariantUrl ? [createHlsTaskLogEntry({
            mode: 'local-plan',
            stage: 'preparing',
            text: `录制变体：${hlsSelectedVariantLabel || selectedHlsVariantUrl}`,
          })] : []),
        ],
        mode: 'local-plan',
        processedSeconds: undefined,
        requestId,
        speedBps: undefined,
        stage: 'preparing',
        state: 'running',
        totalFragments: 0,
      });
      outputTarget = createOutputTargetSnapshot
        ? await createOutputTargetSnapshot()
        : {
          cleanupOutputDirectory: async () => {
            if (outputTarget?.outputDirectoryPath) {
              await onCleanupOutputDirectory?.(outputTarget.outputDirectoryPath);
            }
          },
          outputDirectoryPath: await (resolveOutputDirectoryPath?.() ?? Promise.resolve(outputDirectoryPath)),
          persistOutput: onPersistOutput,
        };
      hlsOutputTargetRef.current = {
        cleanupOutputDirectory: outputTarget.cleanupOutputDirectory,
        persistOutput: outputTarget.persistOutput,
        requestId,
      };
      const result = await startEmbeddedBrowserHlsRecording(hlsRequest.resource.tabId, {
        manifestUrl: effectiveManifestUrl,
        manualKeyBase64: normalizedHlsManualKey || undefined,
        outputDirectoryPath: outputTarget.outputDirectoryPath,
        resourceId: hlsRequest.resource.id,
        requestId,
        segmentQuery: hlsSegmentQueryEnabled ? hlsSegmentQueryDraft : undefined,
        suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
        suggestedThreadCount: hlsCanTuneLocalDownloader ? normalizedHlsThreadCount : hlsRequest.plan.suggestedThreadCount,
        useSystemSaveDialog: false,
      });
      if (result?.cancelled) {
        await outputTarget.cleanupOutputDirectory();
        activeHlsTaskRequestIdRef.current = previousActiveRequestId;
        activeHlsTaskManifestUrlRef.current = previousActiveManifestUrl;
        hlsOutputTargetRef.current = previousOutputTarget;
        if (previousActiveRequestId) {
          setHlsLiveRecordingState(previousLiveState);
          setHlsTaskStatus(previousTaskStatus);
        } else {
          setHlsLiveRecordingState('idle');
          setHlsTaskStatus((previous) => ({
            ...previous,
            logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
              level: 'info',
              mode: 'local-plan',
              stage: 'preparing',
              text: '直播录制已取消',
            })),
            state: 'idle',
          }));
        }
        return;
      }
      if (!result?.ok) {
        throw new Error(result?.error || '启动直播录制失败');
      }
      setHlsLiveRecordingState('recording');
    } catch (error: any) {
      if (outputTarget) {
        await outputTarget.cleanupOutputDirectory();
      }
      activeHlsTaskRequestIdRef.current = previousActiveRequestId;
      activeHlsTaskManifestUrlRef.current = previousActiveManifestUrl;
      hlsOutputTargetRef.current = previousOutputTarget;
      if (previousActiveRequestId) {
        setHlsLiveRecordingState(previousLiveState);
        setHlsTaskStatus(previousTaskStatus);
      } else {
        setHlsLiveRecordingState('idle');
        setHlsTaskStatus((previous) => ({
          ...previous,
          error: error?.message || '启动直播录制失败',
          logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
            level: 'error',
            mode: 'local-plan',
            stage: 'error',
            text: error?.message || '启动直播录制失败',
          })),
          stage: 'error',
          state: 'error',
        }));
      }
      Toast.error(error?.message || '启动直播录制失败');
    } finally {
      setSavingHls(false);
    }
  }, [
    hlsCanTuneLocalDownloader,
    hlsManualKeyInvalid,
    hlsRequest,
    hlsSegmentQueryDraft,
    hlsSegmentQueryEnabled,
    hlsTaskStatus,
    hlsSelectedVariantLabel,
    normalizedHlsManualKey,
    normalizedHlsThreadCount,
    createOutputTargetSnapshot,
    onCleanupOutputDirectory,
    onPersistOutput,
    outputDirectoryPath,
    resolveOutputDirectoryPath,
    selectedHlsAudioRenditionUrl,
    selectedHlsVariantUrl,
  ]);

  const handleStopLiveRecording = React.useCallback(async () => {
    if (!hlsRequest || !hlsTaskStatus.requestId) {
      Toast.warning('当前没有可停止的直播录制任务');
      return;
    }
    setSavingHls(true);
    setHlsLiveRecordingState('stopping');
    try {
      const result = await stopEmbeddedBrowserHlsRecording(hlsRequest.resource.tabId, {
        requestId: hlsTaskStatus.requestId,
      });
      if (result?.cancelled) {
        setHlsLiveRecordingState('idle');
        return;
      }
      if (!result?.outputPath) {
        throw new Error(result?.error || '直播录制停止后未生成输出文件');
      }
      const outputTarget = hlsOutputTargetRef.current?.requestId === hlsTaskStatus.requestId
        ? hlsOutputTargetRef.current
        : null;
      await (outputTarget?.persistOutput || onPersistOutput)(result.outputPath);
      hlsOutputTargetRef.current = null;
      setHlsLiveRecordingState('idle');
    } catch (error: any) {
      setHlsLiveRecordingState('idle');
      setHlsTaskStatus((previous) => ({
        ...previous,
        error: error?.message || '停止直播录制失败',
        logs: appendHlsTaskLogs(previous.logs, createHlsTaskLogEntry({
          level: 'error',
          mode: previous.mode,
          stage: 'error',
          text: `${error?.message || '停止直播录制失败'}；可再次点击“重试导出”继续`,
        })),
        stage: 'error',
        state: 'error',
      }));
      Toast.error(error?.message || '停止直播录制失败');
    } finally {
      setSavingHls(false);
    }
  }, [hlsRequest, hlsTaskStatus.requestId, onPersistOutput]);

  const handleVerifyHlsKey = React.useCallback(async () => {
    if (!hlsRequest) {
      Toast.warning('先从资源面板解析 HLS，再送到工具页');
      return;
    }
    const verificationToken = `${hlsRequest.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeHlsKeyVerificationTokenRef.current = verificationToken;
    setVerifyingHlsKey(true);
    try {
      const snapshot = await listEmbeddedBrowserCapturedResources(hlsRequest.resource.tabId);
      const resources = snapshot?.status === 'active' ? snapshot.resources : [];
      const result = await verifyHlsResourceKey({
        manualKeyBase64: normalizedHlsManualKey || undefined,
        manifest: hlsRequest.manifest,
        manifestResource: hlsRequest.resource,
        resources,
      });
      if (activeHlsKeyVerificationTokenRef.current !== verificationToken) {
        return;
      }
      setHlsKeyVerificationResult(result);
      if (result.mediaAlreadyReadable) {
        Toast.success('片段本身可读，不需要 key');
        return;
      }
      if (result.ok && result.candidate) {
        Toast.success(`已验证到可用 key：${result.candidate.label}`);
        return;
      }
      Toast.warning(result.error || 'key 验证未命中');
    } catch (error: any) {
      const fallbackResult = {
        error: error?.message || 'key 验证失败',
        mediaAlreadyReadable: false,
        ok: false,
        reason: 'verify-failed',
      } satisfies EmbeddedBrowserHlsKeyVerificationResult;
      if (activeHlsKeyVerificationTokenRef.current !== verificationToken) {
        return;
      }
      setHlsKeyVerificationResult(fallbackResult);
      Toast.error(fallbackResult.error);
    } finally {
      if (activeHlsKeyVerificationTokenRef.current === verificationToken) {
        activeHlsKeyVerificationTokenRef.current = '';
        setVerifyingHlsKey(false);
      }
    }
  }, [hlsRequest, normalizedHlsManualKey]);

  return {
    canSelectVariant: hlsCanSelectVariant,
    canTuneLocalDownloader: hlsCanTuneLocalDownloader,
    hlsAes128KeyCount,
    hlsAudioRenditions,
    hlsAudioRenditionOptions,
    hlsKeyVerificationResult,
    hlsLiveRecordingState,
    hlsManualKeyDraft,
    hlsManualKeyInputMode,
    hlsManualKeyInvalid,
    hlsNonAesKeyCount,
    hlsRangeEnd: normalizedHlsRangeEnd,
    hlsRangeStart: normalizedHlsRangeStart,
    hlsRequest,
    hlsSegmentQueryDraft,
    hlsSegmentQueryEnabled,
    hlsSelectedVariant,
    hlsSelectedVariantLabel,
    hlsSelectedAudioRendition,
    hlsSelectedSubtitleRendition,
    hlsSubtitleRenditions,
    hlsSubtitleRenditionOptions,
    hlsTaskProgressPercent,
    hlsTaskProgressSummary,
    hlsTaskStatus,
    hlsThreadCount: normalizedHlsThreadCount,
    hlsUsingCustomThreadCount,
    hlsUsingFragmentRange,
    hlsVariantOptions,
    normalizedHlsManualKey,
    savingHls,
    selectedHlsAudioRenditionUrl,
    selectedHlsSubtitleRenditionUrl,
    selectedHlsVariantUrl,
    verifyingHlsKey,
    handlers: {
      onStartLiveRecording: () => void handleStartLiveRecording(),
      onStopLiveRecording: () => void handleStopLiveRecording(),
      onDownloadSelectedSubtitle: () => void handleDownloadSelectedSubtitle(),
      onRetryFailed: () => void (
        hlsTaskStatus.state === 'error'
          ? handleRetryFailedHls()
          : handleSaveHls()
      ),
      onSaveHls: () => void handleSaveHls(),
      onSetSelectedHlsAudioRenditionUrl: setSelectedHlsAudioRenditionUrl,
      onSetSelectedHlsSubtitleRenditionUrl: setSelectedHlsSubtitleRenditionUrl,
      onSetHlsManualKeyDraft: setHlsManualKeyDraft,
      onSetHlsSegmentQueryDraft: setHlsSegmentQueryDraft,
      onSetHlsSegmentQueryEnabled: setHlsSegmentQueryEnabled,
      onSetHlsRangeEnd: (value: number) => setHlsRangeEndDraft(Number(value || 1)),
      onSetHlsRangeStart: (value: number) => setHlsRangeStartDraft(Number(value || 1)),
      onSetHlsThreadCount: (value: number) => setHlsThreadCountDraft(Number(value || 1)),
      onSetSelectedHlsVariantUrl: setSelectedHlsVariantUrl,
      onVerifyHlsKey: () => void handleVerifyHlsKey(),
    },
  };
}
