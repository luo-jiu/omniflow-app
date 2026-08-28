import { describe, expect, it, vi } from 'vitest'

import type { EmbeddedBrowserHlsDownloadPlan } from '../contracts/hls'
import {
  EmbeddedBrowserHlsLiveRecorder,
} from '../../embeddedBrowserHlsLiveRecorder'
import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
} from '../../embeddedBrowserHlsLocalDownloaderService'
import { HlsLiveTask } from './hls-live-task'
import {
  defaultHlsTaskExecutor,
  downloadHlsToLocalWorkDirectory,
  HlsTaskExecutor,
} from './hls-task'

describe('HLS processing owner boundary', () => {
  it('hls.processing-owner-boundary', () => {
    expect(defaultHlsTaskExecutor).toBeInstanceOf(HlsTaskExecutor)
    expect(downloadEmbeddedBrowserHlsToLocalWorkDirectory).toBe(downloadHlsToLocalWorkDirectory)
    expect(EmbeddedBrowserHlsLiveRecorder).toBe(HlsLiveTask)
  })

  it('hls.plan-task-executor', async () => {
    const plan: EmbeddedBrowserHlsDownloadPlan = {
      durationSeconds: 4,
      encryptedSegmentCount: 0,
      fragmentCount: 2,
      fragments: [0, 1].map(index => ({
        discontinuitySequence: 0,
        duration: 2,
        index,
        part: false,
        sequence: index + 1,
        url: `https://media.example/segment-${index + 1}.ts`,
      })),
      headers: {},
      isLive: false,
      isMaster: false,
      keys: [],
      manifestUrl: 'https://media.example/playlist.m3u8',
      maps: [],
      mapTag: '',
      partCount: 0,
      renditions: [],
      segmentCount: 2,
      segments: [],
      suggestedThreadCount: 2,
      variants: [],
    }
    const downloadLocal = vi.fn(async (request: Parameters<
      typeof defaultHlsTaskExecutor.downloadToLocalWorkDirectory
    >[0]) => {
      request.onEvent?.({
        completedFragments: 2,
        message: 'local ready',
        stage: 'rewriting-playlist',
        status: 'running',
        totalFragments: 2,
      })
      return {
        downloadedFragmentCount: 2,
        keyCount: 0,
        mapCount: 0,
        playlistPath: '/tmp/hls-task/local-playlist.m3u8',
        workDirectoryPath: '/tmp/hls-task',
      }
    })
    const executor = new HlsTaskExecutor({
      downloadToLocalWorkDirectory: downloadLocal,
    })
    const runFfmpeg = vi.fn(async (input: {
      onProgress: (progress: { processedSeconds?: number; speedText?: string }) => void
    }) => {
      input.onProgress({ processedSeconds: 2, speedText: '1.0x' })
      return {
        ffmpegPath: '/usr/bin/ffmpeg',
        outputPath: '/tmp/output.mp4',
      }
    })
    const events: Array<{ failedFragments?: number[]; message?: string; stage: string }> = []
    const completionOrder: string[] = []

    await expect(executor.executePlanToOutput({
      beforeCompleted: () => {
        completionOrder.push('before-completed')
      },
      fragmentIndexes: [1],
      onEvent: (event) => {
        events.push(event)
        if (event.stage === 'completed') {
          completionOrder.push('completed')
        }
      },
      outputPath: '/tmp/output.mp4',
      plan,
      runFfmpeg,
      workDirectoryPath: '/tmp/hls-task',
    })).resolves.toEqual({
      ffmpegPath: '/usr/bin/ffmpeg',
      outputPath: '/tmp/output.mp4',
    })
    expect(downloadLocal).toHaveBeenCalledWith(expect.objectContaining({
      fragmentIndexes: [1],
      preprocessFragments: true,
      workDirectoryPath: '/tmp/hls-task',
    }))
    expect(runFfmpeg).toHaveBeenCalledWith(expect.objectContaining({
      manifestUrl: '/tmp/hls-task/local-playlist.m3u8',
      outputPath: '/tmp/output.mp4',
    }))
    expect(events).toEqual([
      expect.objectContaining({
        failedFragments: [2],
        message: '开始重试 1 个失败分片',
        stage: 'downloading-fragments',
      }),
      expect.objectContaining({ message: 'local ready', stage: 'rewriting-playlist' }),
      expect.objectContaining({ message: '失败分片已补齐，开始交给 ffmpeg', stage: 'ffmpeg' }),
      expect.objectContaining({ stage: 'ffmpeg' }),
      expect.objectContaining({ message: 'HLS 下载完成', stage: 'completed' }),
    ])
    expect(completionOrder).toEqual(['before-completed', 'completed'])
  })
})
