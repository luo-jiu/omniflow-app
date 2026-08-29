import path from 'node:path'
import { access, mkdir } from 'node:fs/promises'
import { app } from 'electron'
import { resolveEmbeddedBrowserFfmpegPath } from './embeddedBrowserResourceMergeService'
import { defaultFfmpegTaskExecutor } from './embedded-browser/processing/ffmpeg-executor'

export type MediaToolOperation = 'extract-audio' | 'compress-video'

export type MediaToolProcessFileRequest = {
  ffmpegPath?: string
  inputFileName?: string
  inputUrl: string
  operation: MediaToolOperation
  outputDirectoryPath?: string
}

export type MediaToolProcessFileResponse = {
  commandArgs?: string[]
  error?: string
  ffmpegPath?: string
  ok: boolean
  outputPath?: string
}

function isMediaToolOperation(input: unknown): input is MediaToolOperation {
  return input === 'extract-audio' || input === 'compress-video'
}

function sanitizeFileName(input: string) {
  const normalized = String(input || '').trim().replace(/[\\/:*?"<>|]+/g, '_')
  return normalized || 'media'
}

function deriveOutputFileName(inputFileName: string | undefined, operation: MediaToolOperation) {
  const parsed = path.parse(sanitizeFileName(inputFileName || 'media'))
  const baseName = parsed.name || 'media'
  if (operation === 'extract-audio') {
    return `${baseName}-audio.m4a`
  }
  return `${baseName}-compressed.mp4`
}

async function resolveUniqueOutputPath(outputDirectoryPath: string, fileName: string) {
  const parsed = path.parse(fileName)
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`
    const candidate = path.join(outputDirectoryPath, `${parsed.name}${suffix}${parsed.ext}`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
  return path.join(outputDirectoryPath, `${parsed.name}-${Date.now()}${parsed.ext}`)
}

function buildMediaToolArgs(request: {
  inputUrl: string
  operation: MediaToolOperation
  outputPath: string
}) {
  if (request.operation === 'extract-audio') {
    return [
      '-y',
      '-i',
      request.inputUrl,
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      request.outputPath,
    ]
  }

  return [
    '-y',
    '-i',
    request.inputUrl,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '28',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    request.outputPath,
  ]
}

export async function processMediaToolFile(
  request: MediaToolProcessFileRequest,
): Promise<MediaToolProcessFileResponse> {
  const inputUrl = String(request.inputUrl || '').trim()
  if (!inputUrl) {
    return { ok: false, error: '缺少输入文件地址' }
  }
  if (!isMediaToolOperation(request.operation)) {
    return { ok: false, error: '未知的媒体处理操作' }
  }

  const ffmpegPath = await resolveEmbeddedBrowserFfmpegPath(request.ffmpegPath)
  if (!ffmpegPath) {
    return { ok: false, error: '未找到可用的 ffmpeg，可在系统环境变量里配置，或确认 /opt/homebrew/bin/ffmpeg 可执行' }
  }

  const outputDirectoryPath = path.resolve(
    String(request.outputDirectoryPath || '').trim() || app.getPath('downloads'),
  )
  await mkdir(outputDirectoryPath, { recursive: true })

  const outputPath = await resolveUniqueOutputPath(
    outputDirectoryPath,
    deriveOutputFileName(request.inputFileName, request.operation),
  )
  const commandArgs = buildMediaToolArgs({
    inputUrl,
    operation: request.operation,
    outputPath,
  })

  try {
    await defaultFfmpegTaskExecutor.execute({
      commandArgs,
      ffmpegPath,
      outputPath,
    })
    return {
      commandArgs,
      ffmpegPath,
      ok: true,
      outputPath,
    }
  } catch (error) {
    return {
      commandArgs,
      error: error instanceof Error ? error.message : String(error),
      ffmpegPath,
      ok: false,
      outputPath,
    }
  }
}
