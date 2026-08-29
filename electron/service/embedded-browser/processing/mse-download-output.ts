import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { EmbeddedBrowserDownloadPayload } from '../../embeddedBrowserService'

export type MseDownloadOutputResource = {
  base64?: string
  fileName: string
  filePath?: string
  mimeType?: string
  resourceKey: string
  streamType?: 'audio' | 'video'
  url?: string
}

type CreateMseDownloadStagingPathOptions = {
  fileName: string
  stagingRootPath: string
}

type EmitMseDownloadCompletedOptions = {
  emitDownload: (payload: EmbeddedBrowserDownloadPayload) => void
  fileName: string
  filePath: string
  mimeType?: string
  pageUrl?: string
  resourceKey: string
  streamType?: 'audio' | 'video'
  tabId: string
  url?: string
}

function sanitizeFileName(value: string) {
  const normalized = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim()
  return normalized || 'media.bin'
}

function buildStagedFileName(fileName: string) {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFileName(fileName)}`
}

export async function createMseDownloadStagingPath(
  options: CreateMseDownloadStagingPathOptions,
) {
  const rawStagingRootPath = String(options.stagingRootPath || '').trim()
  if (!rawStagingRootPath) {
    throw new Error('无效的下载暂存目录')
  }
  const stagingRootPath = path.resolve(rawStagingRootPath)
  await mkdir(stagingRootPath, { recursive: true })
  return path.join(stagingRootPath, buildStagedFileName(options.fileName))
}

export async function emitMseDownloadCompleted(
  options: EmitMseDownloadCompletedOptions,
) {
  const filePath = path.resolve(String(options.filePath || '').trim())
  if (!filePath) {
    throw new Error('缺少 MSE 下载文件')
  }
  const metadata = await stat(filePath)
  const totalBytes = Math.max(0, Number(metadata.size || 0))
  const url = String(options.url || '').trim() || `mse://${options.resourceKey}`
  const payload: EmbeddedBrowserDownloadPayload = {
    downloadId: `embedded-browser-mse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: sanitizeFileName(options.fileName),
    mimeType: options.mimeType,
    pageUrl: options.pageUrl,
    receivedBytes: totalBytes,
    state: 'completed',
    tabId: options.tabId,
    tempPath: filePath,
    totalBytes,
    url,
  }
  options.emitDownload(payload)
  return payload
}
