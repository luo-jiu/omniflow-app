import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'

export type EmbeddedBrowserExtractedResourceFile = {
  base64?: string
  fileName: string
  mimeType?: string
  requestHeaders?: Record<string, string>
  resourceKey?: string
  streamType?: 'audio' | 'video'
  url?: string
}

export type EmbeddedBrowserResourceMergeRequest = {
  audio: EmbeddedBrowserExtractedResourceFile
  ffmpegPath?: string
  outputPath: string
  video: EmbeddedBrowserExtractedResourceFile
}

export type EmbeddedBrowserResourceMergeResult = {
  commandArgs: string[]
  ffmpegPath: string
  outputPath: string
  stderr: string
  stdout: string
}

const COMMON_FFMPEG_PATHS = [
  process.env.OMNIFLOW_FFMPEG_PATH,
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  'ffmpeg',
].filter((value): value is string => Boolean(value))

const FFMPEG_HTTP_HEADER_BLACKLIST = new Set([
  'accept-encoding',
  'connection',
  'host',
  'range',
])

function sanitizeFileName(input: string) {
  const normalized = String(input || '').trim().replace(/[\\/:*?"<>|]+/g, '_')
  return normalized || 'media'
}

async function canExecuteFile(candidatePath: string) {
  if (!candidatePath || candidatePath === 'ffmpeg') {
    return false
  }
  try {
    await access(candidatePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function canExecuteCommand(candidateCommand: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(candidateCommand, ['-version'], {
      stdio: 'ignore',
    })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

export async function resolveEmbeddedBrowserFfmpegPath(preferredPath?: string) {
  const candidates = [
    String(preferredPath || '').trim() || undefined,
    ...COMMON_FFMPEG_PATHS,
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index)

  for (const candidate of candidates) {
    if (candidate === 'ffmpeg') {
      if (await canExecuteCommand(candidate)) {
        return candidate
      }
      continue
    }
    if (await canExecuteFile(candidate)) {
      return candidate
    }
  }
  return null
}

export function buildEmbeddedBrowserResourceMergeArgs(request: {
  audio: EmbeddedBrowserPreparedMergeInput
  outputPath: string
  video: EmbeddedBrowserPreparedMergeInput
}) {
  return [
    '-y',
    ...request.video.inputArgs,
    '-i',
    request.video.path,
    ...request.audio.inputArgs,
    '-i',
    request.audio.path,
    '-c',
    'copy',
    request.outputPath,
  ]
}

export function deriveEmbeddedBrowserMergedFileName(
  videoFileName: string,
  audioFileName: string,
) {
  const normalizedVideoName = sanitizeFileName(path.parse(videoFileName).name)
  const normalizedAudioName = sanitizeFileName(path.parse(audioFileName).name)
  const mergedBaseName = normalizedVideoName
    .replace(/-video$/i, '')
    .replace(/_video$/i, '')
    || normalizedAudioName.replace(/-audio$/i, '').replace(/_audio$/i, '')
    || 'merged-media'
  return `${mergedBaseName}.mp4`
}

export async function createEmbeddedBrowserResourceMergeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'omniflow-resource-merge-'))
}

export async function cleanupEmbeddedBrowserResourceMergeTempDir(tempDir: string) {
  if (!tempDir) {
    return
  }
  await rm(tempDir, {
    force: true,
    recursive: true,
  })
}

async function writeExtractedResourceToTempFile(
  tempDir: string,
  resource: EmbeddedBrowserExtractedResourceFile,
) {
  if (!resource.base64) {
    throw new Error('缺少可写入的资源内容')
  }
  const filePath = path.join(tempDir, sanitizeFileName(resource.fileName))
  await writeFile(filePath, Buffer.from(resource.base64, 'base64'))
  return filePath
}

type EmbeddedBrowserPreparedMergeInput = {
  inputArgs: string[]
  path: string
}

function isHttpResourceUrl(input: string) {
  return /^https?:\/\//i.test(String(input || '').trim())
}

function sanitizeHeaderValue(input: string) {
  return String(input || '').replace(/[\r\n]+/g, ' ').trim()
}

function buildFfmpegHttpInputArgs(resource: EmbeddedBrowserExtractedResourceFile) {
  const url = String(resource.url || '').trim()
  if (!isHttpResourceUrl(url)) {
    return []
  }

  const headers = resource.requestHeaders || {}
  const inputArgs: string[] = []
  const headerLines: string[] = []
  Object.entries(headers).forEach(([rawName, rawValue]) => {
    const headerName = String(rawName || '').trim().toLowerCase()
    const headerValue = sanitizeHeaderValue(rawValue)
    if (!headerName || !headerValue || FFMPEG_HTTP_HEADER_BLACKLIST.has(headerName)) {
      return
    }
    headerLines.push(`${headerName}: ${headerValue}`)
  })
  if (headerLines.length) {
    inputArgs.push('-headers', `${headerLines.join('\r\n')}\r\n`)
  }
  return inputArgs
}

async function prepareResourceMergeInput(
  tempDir: string,
  resource: EmbeddedBrowserExtractedResourceFile,
): Promise<EmbeddedBrowserPreparedMergeInput> {
  const url = String(resource.url || '').trim()
  if (url && isHttpResourceUrl(url) && !resource.base64) {
    return {
      inputArgs: buildFfmpegHttpInputArgs(resource),
      path: url,
    }
  }
  return {
    inputArgs: [],
    path: await writeExtractedResourceToTempFile(tempDir, resource),
  }
}

export async function mergeEmbeddedBrowserResourceTracks(
  request: EmbeddedBrowserResourceMergeRequest,
): Promise<EmbeddedBrowserResourceMergeResult> {
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }

  const tempDir = await createEmbeddedBrowserResourceMergeTempDir()
  try {
    const [audio, video] = await Promise.all([
      prepareResourceMergeInput(tempDir, request.audio),
      prepareResourceMergeInput(tempDir, request.video),
    ])
    const commandArgs = buildEmbeddedBrowserResourceMergeArgs({
      audio,
      outputPath: request.outputPath,
      video,
    })

    const result = await new Promise<EmbeddedBrowserResourceMergeResult>((resolve, reject) => {
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

    return result
  } finally {
    await cleanupEmbeddedBrowserResourceMergeTempDir(tempDir).catch(() => undefined)
  }
}
