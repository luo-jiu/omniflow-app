import { spawn } from 'node:child_process'
import path from 'node:path'
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
}

export type EmbeddedBrowserManifestDownloadResult = {
  commandArgs: string[]
  ffmpegPath: string
  outputPath: string
  stderr: string
  stdout: string
}

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

export async function downloadEmbeddedBrowserManifestResource(
  request: EmbeddedBrowserManifestDownloadRequest,
): Promise<EmbeddedBrowserManifestDownloadResult> {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }
  const commandArgs = buildEmbeddedBrowserManifestDownloadArgs(request)
  return new Promise<EmbeddedBrowserManifestDownloadResult>((resolve, reject) => {
    const stdout: string[] = []
    const stderr: string[] = []
    let lastProcessedSeconds = -1
    let lastSpeedText = ''
    const progressState: {
      processedSeconds?: number
      speedText?: string
    } = {}
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', (chunk) => {
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
      request.onProgress?.({
        processedSeconds: typeof nextProcessedSeconds === 'number'
          ? Math.min(nextProcessedSeconds, request.durationSeconds || Number.POSITIVE_INFINITY)
          : undefined,
        speedText: nextSpeedText || undefined,
      })
    })
    child.stderr.on('data', (chunk) => {
      stderr.push(String(chunk))
    })
    child.once('error', (error) => {
      reject(error)
    })
    child.once('exit', (code) => {
      if (code === 0) {
        resolve({
          commandArgs,
          ffmpegPath,
          outputPath: request.outputPath,
          stderr: stderr.join(''),
          stdout: stdout.join(''),
        })
        return
      }
      reject(new Error(stderr.join('').trim() || `ffmpeg 退出码异常: ${code}`))
    })
  })
}
