import React from 'react';
import { Toast } from '@douyinfe/semi-ui';

import {
  downloadEmbeddedBrowserMpdPlan,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource.api';

import type {
  ToolWorkspaceMediaMpdRequest,
} from '../types';

export type MpdTaskStatus = {
  error?: string;
  lastOutputPath?: string;
  message: string;
  state: 'idle' | 'running' | 'success' | 'error';
};

type UseMpdDownloadTaskInput = {
  createOutputTargetSnapshot?: () => Promise<{
    cleanupOutputDirectory: () => Promise<void>;
    outputDirectoryPath?: string;
    persistOutput: (outputPath: string) => Promise<void>;
  }>;
  mpdRequest: ToolWorkspaceMediaMpdRequest | null;
  onCleanupOutputDirectory?: (outputDirectoryPath: string) => Promise<void>;
  resolveOutputDirectoryPath?: () => Promise<string | undefined>;
  onPersistOutput: (outputPath: string) => Promise<void>;
};

export type MpdRepresentationOption = {
  label: string;
  value: string;
};

function createMpdTaskStatus(
  input?: Partial<MpdTaskStatus>,
): MpdTaskStatus {
  return {
    message: '先在这里选定视频轨和音轨，再发起 MPD 下载。',
    state: 'idle',
    ...input,
  };
}

function formatMpdBandwidth(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return ''
  }
  const mbps = value / 1000 / 1000
  return mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(value / 1000)} Kbps`
}

function formatMpdRepresentationLabel(
  representation: ToolWorkspaceMediaMpdRequest['plan']['representations'][number],
  index: number,
) {
  const parts: string[] = []
  if (representation.contentType === 'video') {
    if (representation.width && representation.height) {
      parts.push(`${representation.width}x${representation.height}`)
    } else {
      parts.push(`视频轨 ${index + 1}`)
    }
    const bandwidthLabel = formatMpdBandwidth(representation.bandwidth)
    if (bandwidthLabel) {
      parts.push(bandwidthLabel)
    }
    if (representation.codecs) {
      parts.push(representation.codecs)
    }
    return parts.join(' · ')
  }

  if (representation.contentType === 'audio') {
    if (representation.language) {
      parts.push(representation.language)
    } else {
      parts.push(`音轨 ${index + 1}`)
    }
    const bandwidthLabel = formatMpdBandwidth(representation.bandwidth)
    if (bandwidthLabel) {
      parts.push(bandwidthLabel)
    }
    if (representation.codecs) {
      parts.push(representation.codecs)
    }
    return parts.join(' · ')
  }

  return `轨道 ${index + 1}`
}

function pickDefaultMpdRepresentation(
  representations: ToolWorkspaceMediaMpdRequest['plan']['representations'],
  contentType: 'audio' | 'video',
) {
  const candidates = representations.filter((item) => item.contentType === contentType)
  if (!candidates.length) {
    return null
  }
  return [...candidates].sort((left, right) => (
    Number(right.bandwidth || 0) - Number(left.bandwidth || 0)
  ))[0] || candidates[0] || null
}

function deriveMpdOutputFileName(input: {
  audioRepresentation: ToolWorkspaceMediaMpdRequest['plan']['representations'][number] | null;
  resourceUrl: string;
  videoRepresentation: ToolWorkspaceMediaMpdRequest['plan']['representations'][number] | null;
}) {
  let baseName = 'dash-media'
  try {
    const decoded = decodeURIComponent(new URL(input.resourceUrl).pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.mpd$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
    if (decoded) {
      baseName = decoded
    }
  } catch {
    // Keep stable fallback.
  }

  const primaryRepresentation = input.videoRepresentation || input.audioRepresentation
  const mimeType = String(primaryRepresentation?.mimeType || '').toLowerCase()
  let extension = 'mp4'
  if (!input.videoRepresentation && input.audioRepresentation) {
    extension = mimeType.includes('webm') ? 'webm' : 'm4a'
  } else if (mimeType.includes('webm')) {
    extension = 'webm'
  }
  return `${baseName}.${extension}`
}

export function useMpdDownloadTask(input: UseMpdDownloadTaskInput) {
  const {
    createOutputTargetSnapshot,
    mpdRequest,
    onCleanupOutputDirectory,
    onPersistOutput,
    resolveOutputDirectoryPath,
  } = input
  const [savingMpd, setSavingMpd] = React.useState(false)
  const [selectedAudioRepresentationId, setSelectedAudioRepresentationId] = React.useState('')
  const [selectedVideoRepresentationId, setSelectedVideoRepresentationId] = React.useState('')
  const [mpdTaskStatus, setMpdTaskStatus] = React.useState<MpdTaskStatus>(() => createMpdTaskStatus())
  const activeRequestIdRef = React.useRef<string>('')
  const activeRunTokenRef = React.useRef<string | null>(null)

  const videoRepresentations = React.useMemo(() => (
    mpdRequest?.plan.representations.filter((item) => item.contentType === 'video') || []
  ), [mpdRequest])
  const audioRepresentations = React.useMemo(() => (
    mpdRequest?.plan.representations.filter((item) => item.contentType === 'audio') || []
  ), [mpdRequest])

  React.useEffect(() => {
    activeRequestIdRef.current = String(mpdRequest?.id || '')
    activeRunTokenRef.current = null
    const defaultVideo = pickDefaultMpdRepresentation(mpdRequest?.plan.representations || [], 'video')
    const defaultAudio = pickDefaultMpdRepresentation(mpdRequest?.plan.representations || [], 'audio')
    setSelectedVideoRepresentationId(defaultVideo?.id || '')
    setSelectedAudioRepresentationId(defaultAudio?.id || '')
    setSavingMpd(false)
    setMpdTaskStatus(createMpdTaskStatus())
  }, [mpdRequest])

  const selectedVideoRepresentation = React.useMemo(() => (
    videoRepresentations.find((item) => item.id === selectedVideoRepresentationId) || null
  ), [selectedVideoRepresentationId, videoRepresentations])
  const selectedAudioRepresentation = React.useMemo(() => (
    audioRepresentations.find((item) => item.id === selectedAudioRepresentationId) || null
  ), [audioRepresentations, selectedAudioRepresentationId])

  const videoRepresentationOptions = React.useMemo<MpdRepresentationOption[]>(() => (
    videoRepresentations.map((representation, index) => ({
      label: formatMpdRepresentationLabel(representation, index),
      value: representation.id,
    }))
  ), [videoRepresentations])

  const audioRepresentationOptions = React.useMemo<MpdRepresentationOption[]>(() => (
    audioRepresentations.map((representation, index) => ({
      label: formatMpdRepresentationLabel(representation, index),
      value: representation.id,
    }))
  ), [audioRepresentations])

  const handleSaveMpd = React.useCallback(async () => {
    if (!mpdRequest) {
      Toast.warning('先从资源面板送入一条 MPD 计划')
      return
    }
    if (mpdRequest.plan.hasDrm) {
      Toast.warning('这条 MPD 检测到 DRM，第一版下载器先不处理')
      return
    }
    if (!selectedVideoRepresentation && !selectedAudioRepresentation) {
      Toast.warning('至少要选择一条可下载轨道')
      return
    }

    const requestOwnerId = String(mpdRequest.id)
    const runToken = `${requestOwnerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const isStillActive = () => (
      activeRunTokenRef.current === runToken
      && activeRequestIdRef.current === requestOwnerId
    )
    activeRunTokenRef.current = runToken
    setSavingMpd(true)
    setMpdTaskStatus(createMpdTaskStatus({
      message: 'MPD 分片下载已经开始，先在主进程里落本地轨道，再交给 ffmpeg 合并。',
      state: 'running',
    }))

    let outputProduced = false
    let outputTarget: {
      cleanupOutputDirectory: () => Promise<void>;
      outputDirectoryPath?: string;
      persistOutput: (outputPath: string) => Promise<void>;
    } | null = null
    try {
      outputTarget = createOutputTargetSnapshot
        ? await createOutputTargetSnapshot()
        : {
          cleanupOutputDirectory: async () => {
            if (outputTarget?.outputDirectoryPath) {
              await onCleanupOutputDirectory?.(outputTarget.outputDirectoryPath)
            }
          },
          outputDirectoryPath: await resolveOutputDirectoryPath?.(),
          persistOutput: onPersistOutput,
        }
      const result = await downloadEmbeddedBrowserMpdPlan(mpdRequest.resource.tabId, {
        outputDirectoryPath: outputTarget.outputDirectoryPath,
        plan: mpdRequest.plan,
        requestId: runToken,
        selectedAudioRepresentationId: selectedAudioRepresentation?.id,
        selectedVideoRepresentationId: selectedVideoRepresentation?.id,
        suggestedFileName: deriveMpdOutputFileName({
          audioRepresentation: selectedAudioRepresentation,
          resourceUrl: mpdRequest.resource.url,
          videoRepresentation: selectedVideoRepresentation,
        }),
        useSystemSaveDialog: false,
      })
      if (result.cancelled) {
        await outputTarget.cleanupOutputDirectory()
        if (isStillActive()) {
          setMpdTaskStatus(createMpdTaskStatus({
            message: '这次 MPD 下载已取消，没有生成文件。',
          }))
        }
        return
      }
      if (!result.ok || !result.outputPath) {
        throw new Error(result.error || 'MPD 下载失败')
      }
      outputProduced = true
      await outputTarget.persistOutput(result.outputPath)
      if (isStillActive()) {
        setMpdTaskStatus(createMpdTaskStatus({
          lastOutputPath: result.outputPath,
          message: 'MPD 轨道下载和 ffmpeg 合并都已经完成。',
          state: 'success',
        }))
      }
    } catch (error) {
      if (outputTarget && !outputProduced) {
        await outputTarget.cleanupOutputDirectory()
      }
      if (isStillActive()) {
        setMpdTaskStatus(createMpdTaskStatus({
          error: error instanceof Error ? error.message : String(error),
          message: 'MPD 任务中途失败了，先看错误再决定是否换轨道重试。',
          state: 'error',
        }))
        Toast.error(error instanceof Error ? error.message : 'MPD 下载失败')
      }
    } finally {
      if (isStillActive()) {
        activeRunTokenRef.current = null
        setSavingMpd(false)
      }
    }
  }, [
    createOutputTargetSnapshot,
    mpdRequest,
    onCleanupOutputDirectory,
    onPersistOutput,
    resolveOutputDirectoryPath,
    selectedAudioRepresentation,
    selectedVideoRepresentation,
  ])

  return {
    audioRepresentationOptions,
    audioRepresentations,
    mpdRequest,
    mpdTaskStatus,
    savingMpd,
    selectedAudioRepresentation,
    selectedAudioRepresentationId,
    selectedVideoRepresentation,
    selectedVideoRepresentationId,
    videoRepresentationOptions,
    videoRepresentations,
    handlers: {
      onSaveMpd: handleSaveMpd,
      onSetSelectedAudioRepresentationId: setSelectedAudioRepresentationId,
      onSetSelectedVideoRepresentationId: setSelectedVideoRepresentationId,
    },
  }
}
