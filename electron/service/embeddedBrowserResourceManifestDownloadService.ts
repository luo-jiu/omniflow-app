import path from 'node:path'
import { resolveEmbeddedBrowserFfmpegPath } from './embeddedBrowserResourceMergeService'
import { defaultFfmpegTaskExecutor } from './embedded-browser/processing/ffmpeg-executor'

export type EmbeddedBrowserManifestDownloadKind = 'hls' | 'mpd'
export type EmbeddedBrowserManifestInputKind = 'hls-manifest' | 'local-file'

export type EmbeddedBrowserManifestDownloadRequest = {
  durationSeconds?: number
  ffmpegPath?: string
  headers?: Record<string, string>
  inputKind?: EmbeddedBrowserManifestInputKind
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
  inputKind?: EmbeddedBrowserManifestInputKind
  onProgress?: (payload: {
    processedSeconds?: number
    speedText?: string
  }) => void
  outputPath: string
  signal?: AbortSignal
  videoHeaders?: Record<string, string>
  videoManifestUrl: string
}

const FFMPEG_MANIFEST_HEADER_BLACKLIST = new Set([
  'accept-encoding',
  'connection',
  'host',
  'range',
])

const FFMPEG_MANIFEST_INPUT_POLICY_ARGS = [
  '-protocol_whitelist',
  'file,http,https,tcp,tls,crypto,data',
  '-allowed_extensions',
  'ALL',
] as const

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
  const isLocalFile = request.inputKind === 'local-file'
  return [
    '-y',
    '-nostats',
    ...(isLocalFile ? [] : FFMPEG_MANIFEST_INPUT_POLICY_ARGS),
    ...(isLocalFile ? [] : buildFfmpegHttpHeaderArgs(request.headers)),
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
  const isLocalFile = request.inputKind === 'local-file'
  const inputPolicyArgs = isLocalFile ? [] : FFMPEG_MANIFEST_INPUT_POLICY_ARGS
  const videoHeaderArgs = isLocalFile ? [] : buildFfmpegHttpHeaderArgs(request.videoHeaders)
  const audioHeaderArgs = isLocalFile ? [] : buildFfmpegHttpHeaderArgs(request.audioHeaders)
  return [
    '-y',
    '-nostats',
    ...inputPolicyArgs,
    ...videoHeaderArgs,
    '-progress',
    'pipe:1',
    '-i',
    request.videoManifestUrl,
    ...inputPolicyArgs,
    ...audioHeaderArgs,
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


export async function downloadEmbeddedBrowserManifestResource(
  request: EmbeddedBrowserManifestDownloadRequest,
): Promise<EmbeddedBrowserManifestDownloadResult> {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }
  const commandArgs = buildEmbeddedBrowserManifestDownloadArgs(request)
  return await defaultFfmpegTaskExecutor.execute({
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
  return await defaultFfmpegTaskExecutor.execute({
    commandArgs,
    durationSeconds: request.durationSeconds,
    ffmpegPath,
    onProgress: request.onProgress,
    outputPath: request.outputPath,
    signal: request.signal,
  })
}
