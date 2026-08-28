import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedBrowserHlsDownloadPlan } from '../contracts/hls'

const { downloadLocalMock, mergeTracksMock } = vi.hoisted(() => ({
  downloadLocalMock: vi.fn(),
  mergeTracksMock: vi.fn(),
}))

vi.mock('../../embeddedBrowserHlsLocalDownloaderService', () => ({
  downloadEmbeddedBrowserHlsToLocalWorkDirectory: downloadLocalMock,
}))

vi.mock('../../embeddedBrowserResourceManifestDownloadService', () => ({
  downloadEmbeddedBrowserManifestTracks: mergeTracksMock,
}))

import { downloadEmbeddedBrowserHlsLocalTracks } from './hls-local-track-merge'

function createPlan(manifestUrl: string, segmentUrl: string): EmbeddedBrowserHlsDownloadPlan {
  return {
    durationSeconds: 4,
    encryptedSegmentCount: 0,
    fragmentCount: 1,
    fragments: [{
      discontinuitySequence: 0,
      duration: 4,
      index: 0,
      part: false,
      sequence: 1,
      url: segmentUrl,
    }],
    headers: {},
    isLive: false,
    isMaster: false,
    keys: [],
    manifestUrl,
    maps: [],
    mapTag: '',
    partCount: 0,
    renditions: [],
    segmentCount: 1,
    segments: [{
      discontinuitySequence: 0,
      duration: 4,
      part: false,
      sequence: 1,
      url: segmentUrl,
    }],
    suggestedThreadCount: 1,
    variants: [],
  }
}

describe('local HLS track merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    downloadLocalMock.mockImplementation(async ({ workDirectoryPath }) => ({
      downloadedFragmentCount: 1,
      keyCount: 0,
      mapCount: 0,
      playlistPath: `${workDirectoryPath}/local-playlist.m3u8`,
      workDirectoryPath,
    }))
    mergeTracksMock.mockResolvedValue({
      commandArgs: [],
      ffmpegPath: '/usr/bin/ffmpeg',
      outputPath: '/tmp/output.mp4',
      stderr: '',
      stdout: '',
    })
  })

  it('hls.segment-query-local-track-merge', async () => {
    const signal = new AbortController().signal
    const audioFetch = vi.fn()
    const videoFetch = vi.fn()
    const onEvent = vi.fn()

    await expect(downloadEmbeddedBrowserHlsLocalTracks({
      audio: {
        fetch: audioFetch,
        plan: createPlan(
          'https://media.example/audio.m3u8',
          'https://media.example/audio.aac?token=new',
        ),
      },
      ffmpegPath: '/usr/bin/ffmpeg',
      onEvent,
      outputPath: '/tmp/output.mp4',
      signal,
      video: {
        fetch: videoFetch,
        plan: createPlan(
          'https://media.example/video.m3u8',
          'https://media.example/video.ts?token=new',
        ),
      },
      workDirectoryPath: '/tmp/hls-track-work',
    })).resolves.toMatchObject({ outputPath: '/tmp/output.mp4' })

    expect(downloadLocalMock).toHaveBeenCalledTimes(2)
    expect(downloadLocalMock).toHaveBeenCalledWith(expect.objectContaining({
      fetch: videoFetch,
      plan: expect.objectContaining({
        fragments: [expect.objectContaining({ url: 'https://media.example/video.ts?token=new' })],
      }),
      preprocessFragments: true,
      signal: expect.any(AbortSignal),
      workDirectoryPath: '/tmp/hls-track-work/video',
    }))
    expect(downloadLocalMock).toHaveBeenCalledWith(expect.objectContaining({
      fetch: audioFetch,
      plan: expect.objectContaining({
        fragments: [expect.objectContaining({ url: 'https://media.example/audio.aac?token=new' })],
      }),
      preprocessFragments: true,
      signal: expect.any(AbortSignal),
      workDirectoryPath: '/tmp/hls-track-work/audio',
    }))
    const videoDownload = downloadLocalMock.mock.calls.find(
      ([request]) => request.workDirectoryPath.endsWith('/video'),
    )?.[0]
    const audioDownload = downloadLocalMock.mock.calls.find(
      ([request]) => request.workDirectoryPath.endsWith('/audio'),
    )?.[0]
    expect(videoDownload?.signal).toBe(audioDownload?.signal)
    expect(videoDownload?.signal.aborted).toBe(false)
    expect(mergeTracksMock).toHaveBeenCalledWith(expect.objectContaining({
      audioManifestUrl: '/tmp/hls-track-work/audio/local-playlist.m3u8',
      outputPath: '/tmp/output.mp4',
      signal,
      videoManifestUrl: '/tmp/hls-track-work/video/local-playlist.m3u8',
    }))
  })

  it('aggregates track progress without completing before ffmpeg', async () => {
    downloadLocalMock.mockImplementation(async ({ onEvent, workDirectoryPath }) => {
      const isVideo = workDirectoryPath.endsWith('/video')
      onEvent?.({
        bytesReceived: isVideo ? 80 : 20,
        bytesTotal: isVideo ? 100 : 25,
        completedFragments: 1,
        message: '轨道下载完成',
        stage: 'completed',
        status: 'success',
        totalFragments: 1,
      })
      return {
        downloadedFragmentCount: 1,
        keyCount: 0,
        mapCount: 0,
        playlistPath: `${workDirectoryPath}/local-playlist.m3u8`,
        workDirectoryPath,
      }
    })
    const onEvent = vi.fn()

    await downloadEmbeddedBrowserHlsLocalTracks({
      audio: { fetch: vi.fn(), plan: createPlan('https://media.example/audio.m3u8', 'https://media.example/audio.aac') },
      onEvent,
      outputPath: '/tmp/output.mp4',
      video: { fetch: vi.fn(), plan: createPlan('https://media.example/video.m3u8', 'https://media.example/video.ts') },
      workDirectoryPath: '/tmp/hls-track-work',
    })

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      bytesReceived: 100,
      bytesTotal: 125,
      completedFragments: 2,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: 2,
    }))
  })

  it('cancels the sibling track before rejecting', async () => {
    let audioSignal: AbortSignal | undefined
    downloadLocalMock.mockImplementation(({ signal, workDirectoryPath }) => {
      if (workDirectoryPath.endsWith('/video')) {
        return Promise.reject(new Error('video track failed'))
      }
      audioSignal = signal
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('audio track aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })

    await expect(downloadEmbeddedBrowserHlsLocalTracks({
      audio: { fetch: vi.fn(), plan: createPlan('https://media.example/audio.m3u8', 'https://media.example/audio.aac') },
      outputPath: '/tmp/output.mp4',
      video: { fetch: vi.fn(), plan: createPlan('https://media.example/video.m3u8', 'https://media.example/video.ts') },
      workDirectoryPath: '/tmp/hls-track-work',
    })).rejects.toThrow('video track failed')

    expect(audioSignal?.aborted).toBe(true)
    expect(mergeTracksMock).not.toHaveBeenCalled()
  })
})
