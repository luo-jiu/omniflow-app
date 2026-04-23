import React from 'react';
import { Toast } from '@douyinfe/semi-ui';

import {
  verifyHlsResourceKey,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource-panel-actions';
import {
  createEmbeddedBrowserHlsDownloadPlan,
  parseEmbeddedBrowserHlsManifest,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-manifest';
import {
  downloadEmbeddedBrowserDirectFile,
  downloadEmbeddedBrowserHlsManifest,
  downloadEmbeddedBrowserHlsTracks,
  downloadEmbeddedBrowserHlsPlan,
  listEmbeddedBrowserCapturedResources,
  retryEmbeddedBrowserHlsPlanFailed,
  subscribeEmbeddedBrowserHlsTask,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource.api';
import { withResourceRefererHeader } from '@/features/embedded-browser/resources/services/embedded-browser-resource-request';
import {
  normalizeHlsKeyCandidateValue,
  type EmbeddedBrowserHlsKeyVerificationResult,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-key-verifier';

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
  hlsRequest: ToolWorkspaceMediaHlsRequest | null;
  outputDirectoryPath?: string;
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
    text,
  });
  const plan = createEmbeddedBrowserHlsDownloadPlan({
    headers: input.headers,
    manifest,
    manifestUrl: input.variantManifestUrl,
    pageUrl: input.pageUrl,
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
  const { hlsRequest, onPersistOutput, outputDirectoryPath } = input;
  const [savingHls, setSavingHls] = React.useState(false);
  const [verifyingHlsKey, setVerifyingHlsKey] = React.useState(false);
  const [hlsManualKeyDraft, setHlsManualKeyDraft] = React.useState('');
  const [selectedHlsVariantUrl, setSelectedHlsVariantUrl] = React.useState('');
  const [selectedHlsAudioRenditionUrl, setSelectedHlsAudioRenditionUrl] = React.useState('');
  const [selectedHlsSubtitleRenditionUrl, setSelectedHlsSubtitleRenditionUrl] = React.useState('');
  const [hlsThreadCountDraft, setHlsThreadCountDraft] = React.useState(6);
  const [hlsRangeStartDraft, setHlsRangeStartDraft] = React.useState(1);
  const [hlsRangeEndDraft, setHlsRangeEndDraft] = React.useState(1);
  const [hlsKeyVerificationResult, setHlsKeyVerificationResult] = React.useState<EmbeddedBrowserHlsKeyVerificationResult | null>(null);
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
  const activeHlsKeyVerificationTokenRef = React.useRef('');

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
    hlsAudioRenditions
      .filter((rendition) => Boolean(rendition.url))
      .filter((rendition) => !hlsEffectiveVariant?.audioGroupId || rendition.groupId === hlsEffectiveVariant.audioGroupId)
      .map((rendition, index) => ({
        groupId: rendition.groupId,
        label: formatHlsRenditionOptionLabel(rendition, index),
        value: String(rendition.url || ''),
      }))
  ), [hlsAudioRenditions, hlsEffectiveVariant]);
  const hlsSubtitleRenditionOptions = React.useMemo<HlsRenditionOption[]>(() => (
    hlsSubtitleRenditions
      .filter((rendition) => Boolean(rendition.url))
      .filter((rendition) => !hlsEffectiveVariant?.subtitlesGroupId || rendition.groupId === hlsEffectiveVariant.subtitlesGroupId)
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
    setHlsManualKeyDraft('');
    setSelectedHlsVariantUrl('');
    setSelectedHlsAudioRenditionUrl('');
    setSelectedHlsSubtitleRenditionUrl('');
    setHlsThreadCountDraft(Math.max(1, hlsRequest?.plan.suggestedThreadCount || 6));
    setHlsRangeStartDraft(1);
    setHlsRangeEndDraft(Math.max(1, hlsRequest?.plan.fragmentCount || 1));
    setHlsKeyVerificationResult(null);
    setVerifyingHlsKey(false);
    activeHlsTaskRequestIdRef.current = '';
    activeHlsTaskManifestUrlRef.current = '';
    activeHlsKeyVerificationTokenRef.current = '';
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
  }, [hlsRequest?.id, hlsRequest?.plan.durationSeconds, hlsRequest?.plan.fragmentCount, hlsRequest?.plan.suggestedThreadCount]);

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
    const unsubscribe = subscribeEmbeddedBrowserHlsTask((payload) => {
      if (!hlsRequest || payload.tabId !== hlsRequest.resource.tabId) {
        return;
      }
      if (payload.requestId && activeHlsTaskRequestIdRef.current && payload.requestId !== activeHlsTaskRequestIdRef.current) {
        return;
      }
      if (payload.manifestUrl !== (activeHlsTaskManifestUrlRef.current || hlsRequest.plan.manifestUrl)) {
        return;
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
    });
    return unsubscribe;
  }, [hlsRequest]);

  const handleSaveHls = React.useCallback(async () => {
    if (!hlsRequest) {
      Toast.warning('先从资源面板解析 HLS，再送到工具页');
      return;
    }
    if (hlsManualKeyInvalid) {
      Toast.warning('自定义 key 需要是 16 字节 AES-128，支持 hex 或 base64');
      return;
    }
    if (selectedHlsAudioRenditionUrl && (normalizedHlsManualKey || hlsUsingCustomThreadCount || hlsUsingFragmentRange)) {
      Toast.warning('独立音轨合并当前只支持网络 manifest 主链，不和手动 key / 本地 downloader 控制混用');
      return;
    }
    const shouldUseLocalPlanForControls = hlsCanTuneLocalDownloader && (hlsUsingCustomThreadCount || hlsUsingFragmentRange);
    let effectivePlan = hlsRequest.plan;
    if (shouldUseLocalPlanForControls) {
      const slicedPlanResult = createHlsPlanSlice(hlsRequest.plan, {
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
      && normalizedHlsManualKey
      && selectedHlsVariantUrl
      && /^https?:\/\//i.test(selectedHlsVariantUrl),
    );
    if (hlsRequest.plan.isMaster && normalizedHlsManualKey && !shouldResolveMasterVariantToLocalPlan) {
      Toast.warning('master playlist 使用手动 key 时，先明确选择一个具体变体');
      return;
    }
    setSavingHls(true);
    try {
      const requestId = `hls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resourceHeaders = withResourceRefererHeader(hlsRequest.resource);
      let effectiveManifestUrl = selectedHlsVariantUrl || hlsRequest.plan.manifestUrl;
      let effectiveVideoManifestUrl = selectedHlsVariantUrl || hlsEffectiveVariant?.url || hlsRequest.plan.manifestUrl;
      if (shouldResolveMasterVariantToLocalPlan) {
        const resolvedVariant = await resolveMasterVariantToMediaPlan({
          headers: resourceHeaders,
          pageUrl: hlsRequest.resource.pageUrl,
          variantManifestUrl: selectedHlsVariantUrl,
        });
        effectivePlan = resolvedVariant.plan;
        effectiveManifestUrl = resolvedVariant.plan.manifestUrl;
        effectiveVideoManifestUrl = resolvedVariant.plan.manifestUrl;
      }
      activeHlsTaskRequestIdRef.current = requestId;
      activeHlsTaskManifestUrlRef.current = selectedHlsAudioRenditionUrl ? effectiveVideoManifestUrl : effectiveManifestUrl;
      const shouldUseDirectManifestTrackMerge = Boolean(
        selectedHlsAudioRenditionUrl
        && /^https?:\/\//i.test(effectiveVideoManifestUrl)
        && /^https?:\/\//i.test(selectedHlsAudioRenditionUrl)
        && !normalizedHlsManualKey
        && !shouldUseLocalPlanForControls
      );
      const shouldUseDirectManifestDownload = /^https?:\/\//i.test(effectiveManifestUrl)
        && !normalizedHlsManualKey
        && !shouldUseLocalPlanForControls
        && !shouldUseDirectManifestTrackMerge;
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
            mode: shouldUseDirectManifestDownload || shouldUseDirectManifestTrackMerge ? 'direct-manifest' : 'local-plan',
            stage: 'preparing',
            text: '已创建 HLS 处理任务',
          }),
          createHlsTaskLogEntry({
            mode: shouldUseDirectManifestDownload || shouldUseDirectManifestTrackMerge ? 'direct-manifest' : 'local-plan',
            stage: 'preparing',
            text: selectedHlsVariantUrl ? `已选择变体：${hlsSelectedVariantLabel || selectedHlsVariantUrl}` : '当前使用自动变体策略',
          }),
          ...(shouldUseDirectManifestTrackMerge ? [createHlsTaskLogEntry({
            mode: 'direct-manifest',
            stage: 'preparing',
            text: `已选择独立音轨：${hlsSelectedAudioRendition?.name || hlsSelectedAudioRendition?.language || selectedHlsAudioRenditionUrl}`,
          })] : []),
          ...(shouldUseLocalPlanForControls ? [createHlsTaskLogEntry({
            mode: 'local-plan',
            stage: 'preparing',
            text: `使用下载控制：线程 ${normalizedHlsThreadCount}，分片 #${normalizedHlsRangeStart}-#${normalizedHlsRangeEnd}`,
          })] : []),
        ],
        mode: shouldUseDirectManifestDownload || shouldUseDirectManifestTrackMerge ? 'direct-manifest' : 'local-plan',
        processedSeconds: undefined,
        requestId,
        speedBps: undefined,
        stage: 'preparing',
        state: 'running',
        totalFragments: effectivePlan.fragmentCount,
      });
      const result = shouldUseDirectManifestTrackMerge
        ? await downloadEmbeddedBrowserHlsTracks(hlsRequest.resource.tabId, {
            audioManifestUrl: selectedHlsAudioRenditionUrl,
            durationSeconds: effectivePlan.durationSeconds,
            headers: withResourceRefererHeader(hlsRequest.resource),
            outputDirectoryPath,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveVideoManifestUrl),
            useSystemSaveDialog: false,
            videoManifestUrl: effectiveVideoManifestUrl,
          })
        : shouldUseDirectManifestDownload
          ? await downloadEmbeddedBrowserHlsManifest(hlsRequest.resource.tabId, {
            durationSeconds: effectivePlan.durationSeconds,
            headers: resourceHeaders,
            manifestUrl: effectiveManifestUrl,
            outputDirectoryPath,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
            useSystemSaveDialog: false,
          })
          : await downloadEmbeddedBrowserHlsPlan(hlsRequest.resource.tabId, {
            manualKeyBase64: normalizedHlsManualKey || undefined,
            outputDirectoryPath,
            plan: effectivePlan,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
            useSystemSaveDialog: false,
          });
      if (result?.cancelled) {
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
        return;
      }
      if (!result?.outputPath) {
        throw new Error('HLS 下载已完成，但未返回输出路径');
      }
      await onPersistOutput(result.outputPath);
    } catch (error: any) {
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
    hlsSelectedAudioRendition,
    hlsSelectedVariantLabel,
    hlsUsingCustomThreadCount,
    hlsUsingFragmentRange,
    normalizedHlsManualKey,
    normalizedHlsRangeEnd,
    normalizedHlsRangeStart,
    normalizedHlsThreadCount,
    onPersistOutput,
    outputDirectoryPath,
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
      await onPersistOutput(result.outputPath);
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
      const result = await verifyHlsResourceKey({
        manualKeyBase64: normalizedHlsManualKey || undefined,
        manifest: hlsRequest.manifest,
        manifestResource: hlsRequest.resource,
        resources: snapshot.resources,
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
    hlsManualKeyDraft,
    hlsManualKeyInputMode,
    hlsManualKeyInvalid,
    hlsNonAesKeyCount,
    hlsRangeEnd: normalizedHlsRangeEnd,
    hlsRangeStart: normalizedHlsRangeStart,
    hlsRequest,
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
      onSetHlsRangeEnd: (value: number) => setHlsRangeEndDraft(Number(value || 1)),
      onSetHlsRangeStart: (value: number) => setHlsRangeStartDraft(Number(value || 1)),
      onSetHlsThreadCount: (value: number) => setHlsThreadCountDraft(Number(value || 1)),
      onSetSelectedHlsVariantUrl: setSelectedHlsVariantUrl,
      onVerifyHlsKey: () => void handleVerifyHlsKey(),
    },
  };
}
