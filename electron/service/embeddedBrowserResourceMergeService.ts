import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'

export type EmbeddedBrowserExtractedResourceFile = {
  base64: string
  fileName: string
  mimeType?: string
  resourceKey: string
  streamType?: 'audio' | 'video'
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
  audioPath: string
  outputPath: string
  videoPath: string
}) {
  return [
    '-y',
    '-i',
    request.videoPath,
    '-i',
    request.audioPath,
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
  const filePath = path.join(tempDir, sanitizeFileName(resource.fileName))
  await writeFile(filePath, Buffer.from(resource.base64, 'base64'))
  return filePath
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
    const [audioPath, videoPath] = await Promise.all([
      writeExtractedResourceToTempFile(tempDir, request.audio),
      writeExtractedResourceToTempFile(tempDir, request.video),
    ])
    const commandArgs = buildEmbeddedBrowserResourceMergeArgs({
      audioPath,
      outputPath: request.outputPath,
      videoPath,
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
