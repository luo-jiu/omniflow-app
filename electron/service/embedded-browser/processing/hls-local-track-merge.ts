import path from 'node:path'

import type { EmbeddedBrowserHlsDownloadPlan } from '../../../../src/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import type { EmbeddedBrowserFragmentFetch } from '../../embeddedBrowserFragmentDownloader'
import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
  type EmbeddedBrowserHlsLocalDownloadRequest,
} from '../../embeddedBrowserHlsLocalDownloaderService'
import {
  downloadEmbeddedBrowserManifestTracks,
  type EmbeddedBrowserManifestDownloadResult,
} from '../../embeddedBrowserResourceManifestDownloadService'

type HlsLocalDownloadEvent = Parameters<
  NonNullable<EmbeddedBrowserHlsLocalDownloadRequest['onEvent']>
>[0]

type HlsLocalTrack = {
  fetch: EmbeddedBrowserFragmentFetch
  plan: EmbeddedBrowserHlsDownloadPlan
}

export type EmbeddedBrowserHlsLocalTrackMergeEvent = HlsLocalDownloadEvent & {
  track?: 'audio' | 'video'
}

export async function downloadEmbeddedBrowserHlsLocalTracks(input: {
  audio: HlsLocalTrack
  ffmpegPath?: string
  onEvent?: (event: EmbeddedBrowserHlsLocalTrackMergeEvent) => void
  onProgress?: (payload: {
    processedSeconds?: number
    speedText?: string
  }) => void
  outputPath: string
  signal?: AbortSignal
  video: HlsLocalTrack
  workDirectoryPath: string
}): Promise<EmbeddedBrowserManifestDownloadResult> {
  const totalFragments = input.video.plan.fragmentCount + input.audio.plan.fragmentCount
  const progressByTrack: Record<'audio' | 'video', {
    bytesReceived: number
    bytesTotal?: number
    completedFragments: number
    etaSeconds?: number
    speedBps?: number
  }> = {
    audio: { bytesReceived: 0, completedFragments: 0 },
    video: { bytesReceived: 0, completedFragments: 0 },
  }
  const forwardTrackEvent = (track: 'audio' | 'video') => (event: HlsLocalDownloadEvent) => {
    const progress = progressByTrack[track]
    if (typeof event.bytesReceived === 'number') progress.bytesReceived = event.bytesReceived
    if (typeof event.bytesTotal === 'number') progress.bytesTotal = event.bytesTotal
    if (typeof event.completedFragments === 'number') progress.completedFragments = event.completedFragments
    if (typeof event.etaSeconds === 'number') progress.etaSeconds = event.etaSeconds
    if (typeof event.speedBps === 'number') progress.speedBps = event.speedBps
    const audioProgress = progressByTrack.audio
    const videoProgress = progressByTrack.video
    const hasCompleteByteTotals = (
      typeof audioProgress.bytesTotal === 'number'
      && typeof videoProgress.bytesTotal === 'number'
    )
    input.onEvent?.({
      ...event,
      bytesReceived: audioProgress.bytesReceived + videoProgress.bytesReceived,
      bytesTotal: hasCompleteByteTotals
        ? audioProgress.bytesTotal! + videoProgress.bytesTotal!
        : undefined,
      completedFragments: videoProgress.completedFragments + audioProgress.completedFragments,
      etaSeconds: typeof audioProgress.etaSeconds === 'number' && typeof videoProgress.etaSeconds === 'number'
        ? Math.max(audioProgress.etaSeconds, videoProgress.etaSeconds)
        : undefined,
      message: `${track === 'video' ? '视频轨' : '音轨'}：${event.message}`,
      speedBps: [audioProgress.speedBps, videoProgress.speedBps]
        .filter((value): value is number => typeof value === 'number')
        .reduce((sum, value) => sum + value, 0) || undefined,
      stage: event.stage === 'completed' ? 'downloading-fragments' : event.stage,
      status: event.status === 'success' ? 'running' : event.status,
      totalFragments,
      track,
    })
  }

  const downloadAbortController = new AbortController()
  const abortDownloads = () => downloadAbortController.abort()
  input.signal?.addEventListener('abort', abortDownloads, { once: true })
  if (input.signal?.aborted) abortDownloads()
  const downloads = [
    downloadEmbeddedBrowserHlsToLocalWorkDirectory({
      fetch: input.video.fetch,
      onEvent: forwardTrackEvent('video'),
      plan: input.video.plan,
      preprocessFragments: true,
      signal: downloadAbortController.signal,
      workDirectoryPath: path.join(input.workDirectoryPath, 'video'),
    }),
    downloadEmbeddedBrowserHlsToLocalWorkDirectory({
      fetch: input.audio.fetch,
      onEvent: forwardTrackEvent('audio'),
      plan: input.audio.plan,
      preprocessFragments: true,
      signal: downloadAbortController.signal,
      workDirectoryPath: path.join(input.workDirectoryPath, 'audio'),
    }),
  ] as const
  let videoResult: Awaited<(typeof downloads)[0]>
  let audioResult: Awaited<(typeof downloads)[1]>
  try {
    [videoResult, audioResult] = await Promise.all(downloads)
  } catch (error) {
    abortDownloads()
    await Promise.allSettled(downloads)
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abortDownloads)
  }

  input.onEvent?.({
    completedFragments: totalFragments,
    message: '视频轨与音轨的本地 playlist 已生成',
    stage: 'rewriting-playlist',
    status: 'running',
    totalFragments,
  })
  return downloadEmbeddedBrowserManifestTracks({
    audioManifestUrl: audioResult.playlistPath,
    durationSeconds: Math.max(
      input.video.plan.durationSeconds,
      input.audio.plan.durationSeconds,
    ),
    ffmpegPath: input.ffmpegPath,
    onProgress: input.onProgress,
    outputPath: input.outputPath,
    signal: input.signal,
    videoManifestUrl: videoResult.playlistPath,
  })
}
