import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { defaultFfmpegTaskExecutor } from './embedded-browser/processing/ffmpeg-executor'

export type EmbeddedBrowserExtractedResourceFile = {
  base64?: string
  fileName: string
  filePath?: string
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

export type EmbeddedBrowserResourceTranscodeFormat = string

export type EmbeddedBrowserResourceTranscodeRequest = {
  ffmpegPath?: string
  outputFormat: EmbeddedBrowserResourceTranscodeFormat
  outputPath: string
  resource: EmbeddedBrowserExtractedResourceFile
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

export function normalizeEmbeddedBrowserResourceTranscodeFormat(input: string) {
  const normalized = String(input || '').trim().replace(/^\.+/, '').toLowerCase()
  if (!/^[a-z0-9]{1,12}$/.test(normalized)) {
    return null
  }
  return normalized
}

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

export function buildEmbeddedBrowserResourceTranscodeArgs(request: {
  input: EmbeddedBrowserPreparedMergeInput
  outputFormat: EmbeddedBrowserResourceTranscodeFormat
  outputPath: string
}) {
  const normalizedFormat = normalizeEmbeddedBrowserResourceTranscodeFormat(request.outputFormat)
  if (!normalizedFormat) {
    throw new Error('请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4')
  }
  const outputArgsByFormat: Record<string, string[]> = {
    aac: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    aiff: ['-vn'],
    alac: ['-vn', '-c:a', 'alac'],
    flac: ['-vn', '-c:a', 'flac'],
    m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    mp3: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'],
    ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
    opus: ['-vn', '-c:a', 'libopus', '-b:a', '128k'],
    wav: ['-vn', '-c:a', 'pcm_s16le'],
    weba: ['-vn', '-c:a', 'libopus', '-b:a', '128k'],
    webm: ['-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libvpx-vp9', '-c:a', 'libopus'],
    wma: ['-vn'],
  }
  const outputArgs = outputArgsByFormat[normalizedFormat]
    || ['-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart']
  return [
    '-y',
    ...request.input.inputArgs,
    '-i',
    request.input.path,
    ...outputArgs,
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
  if (resource.filePath) {
    return resource.filePath
  }
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
  if (!String(request.outputPath || '').trim()) {
    throw new Error('输出路径不能为空')
  }
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
    const result = await defaultFfmpegTaskExecutor.execute({
      commandArgs,
      ffmpegPath,
      outputPath: request.outputPath,
    })
    return result
  } finally {
    await cleanupEmbeddedBrowserResourceMergeTempDir(tempDir).catch(() => undefined)
  }
}

export async function transcodeEmbeddedBrowserResource(
  request: EmbeddedBrowserResourceTranscodeRequest,
): Promise<EmbeddedBrowserResourceMergeResult> {
  if (!String(request.outputPath || '').trim()) {
    throw new Error('输出路径不能为空')
  }
  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行')
  }

  const tempDir = await createEmbeddedBrowserResourceMergeTempDir()
  try {
    const input = await prepareResourceMergeInput(tempDir, request.resource)
    const commandArgs = buildEmbeddedBrowserResourceTranscodeArgs({
      input,
      outputFormat: request.outputFormat,
      outputPath: request.outputPath,
    })
    const result = await defaultFfmpegTaskExecutor.execute({
      commandArgs,
      ffmpegPath,
      outputPath: request.outputPath,
    })
    return result
  } finally {
    await cleanupEmbeddedBrowserResourceMergeTempDir(tempDir).catch(() => undefined)
  }
}
