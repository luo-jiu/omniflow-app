import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveEmbeddedBrowserFfmpegPath } from './embeddedBrowserResourceMergeService'

export type EmbeddedBrowserManifestDownloadKind = 'hls' | 'mpd'

export type EmbeddedBrowserManifestDownloadRequest = {
  ffmpegPath?: string
  headers?: Record<string, string>
  kind: EmbeddedBrowserManifestDownloadKind
  manifestUrl: string
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
    '-protocol_whitelist',
    'file,http,https,tcp,tls,crypto,data',
    '-allowed_extensions',
    'ALL',
    ...buildFfmpegHttpHeaderArgs(request.headers),
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
    const child = spawn(ffmpegPath, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', (chunk) => {
      stdout.push(String(chunk))
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
