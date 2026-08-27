import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import {
  appendFile,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'

import type { EmbeddedBrowserMpdDownloadPlanRepresentation } from '@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest'

import {
  EmbeddedBrowserFragmentDownloader,
  type EmbeddedBrowserDownloadFragment,
  type EmbeddedBrowserFragmentFetch,
} from './embeddedBrowserFragmentDownloader'
import {
  resolveEmbeddedBrowserFfmpegPath,
} from './embeddedBrowserResourceMergeService'

type EmbeddedBrowserMpdLocalDownloadTask = {
  fetch?: EmbeddedBrowserFragmentFetch
  ffmpegPath?: string
  headers?: Record<string, string>
  outputPath: string
  selectedAudioRepresentation?: EmbeddedBrowserMpdDownloadPlanRepresentation
  selectedVideoRepresentation?: EmbeddedBrowserMpdDownloadPlanRepresentation
}

type EmbeddedBrowserMpdLocalDownloadResult = {
  ffmpegPath: string
  outputPath: string
}

function buildMpdFaststartArgs(outputPath: string) {
  const normalizedExtension = path.extname(String(outputPath || '')).trim().toLowerCase()
  return normalizedExtension === '.mp4' ? ['-movflags', '+faststart'] : []
}

function sanitizeMpdTempSegmentExtension(value?: string) {
  const normalized = String(value || '').trim().replace(/^\./, '').toLowerCase()
  if (/^[a-z0-9]{1,10}$/.test(normalized)) {
    return normalized
  }
  return ''
}

function inferMpdRepresentationExtension(
  representation: EmbeddedBrowserMpdDownloadPlanRepresentation,
  fallback: string,
) {
  const candidates = [
    representation.initializationUrl,
    representation.segments[0]?.url,
  ]
  for (const candidate of candidates) {
    try {
      const extension = sanitizeMpdTempSegmentExtension(path.extname(new URL(String(candidate || '')).pathname))
      if (extension) {
        return extension
      }
    } catch {
      // Ignore malformed URLs and continue to MIME inference.
    }
  }

  const mimeType = String(representation.mimeType || '').toLowerCase()
  if (mimeType.includes('webm')) {
    return representation.contentType === 'audio' ? 'weba' : 'webm'
  }
  if (mimeType.includes('mp4')) {
    return representation.contentType === 'audio' ? 'm4a' : 'mp4'
  }
  return fallback
}

function buildMpdTrackFragments(
  representation: EmbeddedBrowserMpdDownloadPlanRepresentation,
) {
  const fragments: EmbeddedBrowserDownloadFragment[] = []
  if (representation.initializationUrl) {
    fragments.push({
      index: 0,
      url: representation.initializationUrl,
    })
  }
  const baseIndex = fragments.length
  representation.segments.forEach((segment, index) => {
    fragments.push({
      duration: segment.duration,
      index: baseIndex + index,
      url: segment.url,
    })
  })
  return fragments
}

async function downloadMpdRepresentationToFile(input: {
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  outputPath: string
  representation: EmbeddedBrowserMpdDownloadPlanRepresentation
  threadCount?: number
}) {
  const fragments = buildMpdTrackFragments(input.representation)
  if (!fragments.length) {
    throw new Error('当前 Representation 没有可下载的 init segment 或媒体分片')
  }

  await writeFile(input.outputPath, Buffer.alloc(0))
  const downloader = new EmbeddedBrowserFragmentDownloader({
    fetch: input.fetch,
    fragments,
    headers: input.headers,
    maxRetries: 2,
    thread: Math.max(1, Number(input.threadCount || 8)),
  })

  let writeChain = Promise.resolve()
  let writeError: Error | null = null

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const succeed = () => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    const fail = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    downloader.on('sequentialPush', (buffer) => {
      writeChain = writeChain.then(async () => {
        try {
          await appendFile(input.outputPath, Buffer.from(buffer))
        } catch (error) {
          writeError = error instanceof Error ? error : new Error(String(error))
          downloader.stop()
          fail(writeError)
        }
      })
    })

    downloader.on('error', (message) => {
      fail(new Error(message))
    })

    downloader.on('failed', (_fragments, errors) => {
      void writeChain.then(() => {
        const failedIndexes = Array.from(errors)
          .map((fragment) => Number(fragment.index) + 1)
          .filter((value) => Number.isFinite(value))
        fail(new Error(
          failedIndexes.length
            ? `MPD 分片下载失败：${failedIndexes.map((value) => `#${value}`).join(', ')}`
            : 'MPD 分片下载失败',
        ))
      }).catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)))
      })
    })

    downloader.on('allCompleted', () => {
      void writeChain.then(() => {
        if (writeError) {
          fail(writeError)
          return
        }
        succeed()
      }).catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)))
      })
    })

    downloader.start()
  }).finally(() => {
    downloader.destroy()
  })
}

async function mergeMpdTrackFilesToOutput(input: {
  audioTrackPath?: string
  ffmpegPath?: string
  outputPath: string
  videoTrackPath?: string
}) {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(input.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }

  const faststartArgs = buildMpdFaststartArgs(input.outputPath)
  const commandArgs = input.videoTrackPath && input.audioTrackPath
    ? [
      '-y',
      '-i',
      input.videoTrackPath,
      '-i',
      input.audioTrackPath,
      '-map',
      '0:v:0?',
      '-map',
      '1:a:0?',
      '-c',
      'copy',
      ...faststartArgs,
      input.outputPath,
    ]
    : input.videoTrackPath
      ? [
        '-y',
        '-i',
        input.videoTrackPath,
        '-map',
        '0:v:0?',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        ...faststartArgs,
        input.outputPath,
      ]
      : input.audioTrackPath
        ? [
          '-y',
          '-i',
          input.audioTrackPath,
          '-map',
          '0:a:0?',
          '-c',
          'copy',
          input.outputPath,
        ]
        : []

  if (!commandArgs.length) {
    throw new Error('缺少可合并的 MPD 轨道文件')
  }

  await new Promise<void>((resolve, reject) => {
    const stderr: string[] = []
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.stderr.on('data', (chunk) => {
      stderr.push(String(chunk))
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.join('').trim() || `ffmpeg 退出码异常: ${code}`))
    })
  })

  return {
    ffmpegPath,
    outputPath: input.outputPath,
  }
}

export async function downloadEmbeddedBrowserMpdToOutput(
  input: EmbeddedBrowserMpdLocalDownloadTask,
): Promise<EmbeddedBrowserMpdLocalDownloadResult> {
  if (!input.selectedVideoRepresentation && !input.selectedAudioRepresentation) {
    throw new Error('至少需要选择一条 MPD 轨道')
  }

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mpd-download-'))
  try {
    const videoTrackPath = input.selectedVideoRepresentation
      ? path.join(
        tempDirectory,
        `video-track.${inferMpdRepresentationExtension(input.selectedVideoRepresentation, 'mp4')}`,
      )
      : undefined
    const audioTrackPath = input.selectedAudioRepresentation
      ? path.join(
        tempDirectory,
        `audio-track.${inferMpdRepresentationExtension(input.selectedAudioRepresentation, 'm4a')}`,
      )
      : undefined

    if (input.selectedVideoRepresentation && videoTrackPath) {
      await downloadMpdRepresentationToFile({
        fetch: input.fetch,
        headers: input.headers,
        outputPath: videoTrackPath,
        representation: input.selectedVideoRepresentation,
      })
    }

    if (input.selectedAudioRepresentation && audioTrackPath) {
      await downloadMpdRepresentationToFile({
        fetch: input.fetch,
        headers: input.headers,
        outputPath: audioTrackPath,
        representation: input.selectedAudioRepresentation,
      })
    }

    return mergeMpdTrackFilesToOutput({
      audioTrackPath,
      ffmpegPath: input.ffmpegPath,
      outputPath: input.outputPath,
      videoTrackPath,
    })
  } finally {
    await rm(tempDirectory, { force: true, recursive: true }).catch(() => undefined)
  }
}
