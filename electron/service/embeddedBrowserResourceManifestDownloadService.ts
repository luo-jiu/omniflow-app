import { spawn, type ChildProcess } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { terminateDesktopProcessTree } from '../platform/processTree'
import { resolveEmbeddedBrowserFfmpegPath } from './embeddedBrowserResourceMergeService'

export type EmbeddedBrowserManifestDownloadKind = 'hls' | 'mpd'

export type EmbeddedBrowserManifestDownloadRequest = {
  durationSeconds?: number
  ffmpegPath?: string
  headers?: Record<string, string>
  kind: EmbeddedBrowserManifestDownloadKind
  manifestUrl: string
  onProgress?: (payload: {
    processedSeconds?: number
    speedText?: string
  }) => void
  outputPath: string
  signal?: AbortSignal
}

export type EmbeddedBrowserManifestDownloadResult = {
  commandArgs: string[]
  ffmpegPath: string
  outputPath: string
  stderr: string
  stdout: string
}

export type EmbeddedBrowserManifestTrackMergeRequest = {
  audioHeaders?: Record<string, string>
  audioManifestUrl: string
  durationSeconds?: number
  ffmpegPath?: string
  onProgress?: (payload: {
    processedSeconds?: number
    speedText?: string
  }) => void
  outputPath: string
  signal?: AbortSignal
  videoHeaders?: Record<string, string>
  videoManifestUrl: string
}

const FFMPEG_TERMINATION_GRACE_MS = 1_500
const FFMPEG_TERMINATION_SETTLE_MS = 3_500

const FFMPEG_MANIFEST_HEADER_BLACKLIST = new Set([
  'accept-encoding',
  'connection',
  'host',
  'range',
])

function sanitizeHeaderValue(input: string) {
  return String(input || '').replace(/[\r\n]+/g, ' ').trim()
}

function buildFfmpegHttpHeaderArgs(headers?: Record<string, string>) {
  const headerLines: string[] = []
  Object.entries(headers || {}).forEach(([rawName, rawValue]) => {
    const headerName = String(rawName || '').trim().toLowerCase()
    const headerValue = sanitizeHeaderValue(rawValue)
    if (!headerName || !headerValue || FFMPEG_MANIFEST_HEADER_BLACKLIST.has(headerName)) {
      return
    }
    headerLines.push(`${headerName}: ${headerValue}`)
  })
  return headerLines.length ? ['-headers', `${headerLines.join('\r\n')}\r\n`] : []
}

export function deriveEmbeddedBrowserManifestOutputFileName(input: string, kind: EmbeddedBrowserManifestDownloadKind) {
  try {
    const extensionPattern = kind === 'hls' ? /\.(m3u8|m3u)(?:$|[?#])/i : /\.mpd(?:$|[?#])/i
    const fileName = decodeURIComponent(path.basename(new URL(input).pathname))
      .replace(extensionPattern, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
    if (fileName) {
      return `${fileName}.mp4`
    }
  } catch {
    // Fall through to the stable default.
  }
  return kind === 'hls' ? 'hls-media.mp4' : 'dash-media.mp4'
}

export function buildEmbeddedBrowserManifestDownloadArgs(request: EmbeddedBrowserManifestDownloadRequest) {
  return [
    '-y',
    '-nostats',
    '-protocol_whitelist',
    'file,http,https,tcp,tls,crypto,data',
    '-allowed_extensions',
    'ALL',
    ...buildFfmpegHttpHeaderArgs(request.headers),
    '-progress',
    'pipe:1',
    '-i',
    request.manifestUrl,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    request.outputPath,
  ]
}

export function buildEmbeddedBrowserManifestTrackMergeArgs(request: EmbeddedBrowserManifestTrackMergeRequest) {
  return [
    '-y',
    '-nostats',
    '-protocol_whitelist',
    'file,http,https,tcp,tls,crypto,data',
    '-allowed_extensions',
    'ALL',
    ...buildFfmpegHttpHeaderArgs(request.videoHeaders),
    '-progress',
    'pipe:1',
    '-i',
    request.videoManifestUrl,
    ...buildFfmpegHttpHeaderArgs(request.audioHeaders),
    '-i',
    request.audioManifestUrl,
    '-map',
    '0:v:0?',
    '-map',
    '1:a:0?',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    request.outputPath,
  ]
}

function parseFfmpegProgressChunk(
  state: {
    processedSeconds?: number
    speedText?: string
  },
  chunkText: string,
) {
  String(chunkText || '').split(/\r?\n/).forEach((line) => {
    const normalizedLine = String(line || '').trim()
    if (!normalizedLine || !normalizedLine.includes('=')) {
      return
    }
    const separatorIndex = normalizedLine.indexOf('=')
    const key = normalizedLine.slice(0, separatorIndex).trim()
    const value = normalizedLine.slice(separatorIndex + 1).trim()
    if (!key) {
      return
    }
    if (key === 'out_time_ms' || key === 'out_time_us') {
      const rawValue = Number(value)
      if (Number.isFinite(rawValue) && rawValue >= 0) {
        state.processedSeconds = rawValue / 1_000_000
      }
      return
    }
    if (key === 'speed') {
      state.speedText = value
    }
  })
}

async function assertManifestOutputFile(outputPath: string) {
  try {
    const output = await stat(outputPath)
    if (output.isFile() && output.size > 0) {
      return
    }
  } catch {
    // Normalize missing and unreadable output into the same delivery error.
  }
  throw new Error('ffmpeg 已退出，但没有生成可用的输出文件')
}

function createManifestFfmpegAbortError() {
  const error = new Error('ffmpeg task aborted')
  error.name = 'AbortError'
  return error
}

function terminateManifestFfmpegProcess(child: ChildProcess, force: boolean) {
  terminateDesktopProcessTree(child, {
    environment: process.env,
    force,
  })
}

async function executeEmbeddedBrowserManifestFfmpeg(input: {
  commandArgs: string[]
  durationSeconds?: number
  ffmpegPath: string
  onProgress?: EmbeddedBrowserManifestDownloadRequest['onProgress']
  outputPath: string
  signal?: AbortSignal
}): Promise<EmbeddedBrowserManifestDownloadResult> {
  if (input.signal?.aborted) {
    throw createManifestFfmpegAbortError()
  }
  return new Promise<EmbeddedBrowserManifestDownloadResult>((resolve, reject) => {
    const stdout: string[] = []
    const stderr: string[] = []
    let child: ChildProcess | null = null
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let lastProcessedSeconds = -1
    let lastSpeedText = ''
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let terminationError: Error | null = null
    const progressState: {
      processedSeconds?: number
      speedText?: string
    } = {}

    const cleanup = () => {
      if (forceTimer) {
        clearTimeout(forceTimer)
      }
      if (settleTimer) {
        clearTimeout(settleTimer)
      }
      input.signal?.removeEventListener('abort', handleAbort)
      child?.stdout?.removeAllListeners()
      child?.stderr?.removeAllListeners()
      child?.removeAllListeners()
    }
    const finish = (handler: () => void) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      handler()
    }
    const rejectTask = (error: unknown, removePartialOutput: boolean) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      const rejectResult = () => finish(() => reject(normalizedError))
      if (!removePartialOutput) {
        rejectResult()
        return
      }
      void rm(input.outputPath, { force: true })
        .catch(() => undefined)
        .then(rejectResult)
    }
    const terminate = (error: Error) => {
      if (terminationError) {
        return
      }
      terminationError = error
      if (!child) {
        rejectTask(error, false)
        return
      }
      const runningChild = child
      terminateManifestFfmpegProcess(runningChild, false)
      forceTimer = setTimeout(() => {
        terminateManifestFfmpegProcess(runningChild, true)
      }, FFMPEG_TERMINATION_GRACE_MS)
      forceTimer.unref?.()
      settleTimer = setTimeout(() => {
        rejectTask(error, true)
      }, FFMPEG_TERMINATION_SETTLE_MS)
      settleTimer.unref?.()
    }
    const handleAbort = () => terminate(createManifestFfmpegAbortError())

    try {
      child = spawn(input.ffmpegPath, input.commandArgs, {
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      rejectTask(error, false)
      return
    }

    child.stdout?.on('data', (chunk) => {
      const chunkText = String(chunk)
      stdout.push(chunkText)
      parseFfmpegProgressChunk(progressState, chunkText)
      const nextProcessedSeconds = progressState.processedSeconds
      const nextSpeedText = progressState.speedText || ''
      const progressChanged = (
        (typeof nextProcessedSeconds === 'number'
          && Math.abs(nextProcessedSeconds - lastProcessedSeconds) >= 0.5)
        || (nextSpeedText && nextSpeedText !== lastSpeedText)
      )
      if (!progressChanged) {
        return
      }
      if (typeof nextProcessedSeconds === 'number') {
        lastProcessedSeconds = nextProcessedSeconds
      }
      if (nextSpeedText) {
        lastSpeedText = nextSpeedText
      }
      input.onProgress?.({
        processedSeconds: typeof nextProcessedSeconds === 'number'
          ? Math.min(nextProcessedSeconds, input.durationSeconds || Number.POSITIVE_INFINITY)
          : undefined,
        speedText: nextSpeedText || undefined,
      })
    })
    child.stderr?.on('data', (chunk) => {
      stderr.push(String(chunk))
    })
    child.once('error', (error) => {
      rejectTask(terminationError || error, Boolean(terminationError))
    })
    child.once('exit', (code) => {
      if (terminationError) {
        rejectTask(terminationError, true)
        return
      }
      if (code !== 0) {
        rejectTask(new Error(stderr.join('').trim() || `ffmpeg 退出码异常: ${code}`), true)
        return
      }
      void assertManifestOutputFile(input.outputPath)
        .then(() => {
          finish(() => resolve({
            commandArgs: input.commandArgs,
            ffmpegPath: input.ffmpegPath,
            outputPath: input.outputPath,
            stderr: stderr.join(''),
            stdout: stdout.join(''),
          }))
        })
        .catch((error) => rejectTask(error, true))
    })
    if (input.signal?.aborted) {
      handleAbort()
    } else {
      input.signal?.addEventListener('abort', handleAbort, { once: true })
    }
  })
}

export async function downloadEmbeddedBrowserManifestResource(
  request: EmbeddedBrowserManifestDownloadRequest,
): Promise<EmbeddedBrowserManifestDownloadResult> {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }
  const commandArgs = buildEmbeddedBrowserManifestDownloadArgs(request)
  return executeEmbeddedBrowserManifestFfmpeg({
    commandArgs,
    durationSeconds: request.durationSeconds,
    ffmpegPath,
    onProgress: request.onProgress,
    outputPath: request.outputPath,
    signal: request.signal,
  })
}

export async function downloadEmbeddedBrowserManifestTracks(
  request: EmbeddedBrowserManifestTrackMergeRequest,
): Promise<EmbeddedBrowserManifestDownloadResult> {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }
  const commandArgs = buildEmbeddedBrowserManifestTrackMergeArgs(request)
  return executeEmbeddedBrowserManifestFfmpeg({
    commandArgs,
    durationSeconds: request.durationSeconds,
    ffmpegPath,
    onProgress: request.onProgress,
    outputPath: request.outputPath,
    signal: request.signal,
  })
}
