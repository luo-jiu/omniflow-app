import { app, type Session, type WebContentsView } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  EmbeddedBrowserPageDragFallbackResource,
  EmbeddedBrowserPageDragSource,
  EmbeddedBrowserStagePageDragRequest,
  EmbeddedBrowserStagedPageDragFile,
} from '@/features/file-transfer/model/browser-drag-transfer'
import { normalizeDownloadFileName } from '../../src/features/file-transfer/model/download-file-name'

const PAGE_DRAG_SESSION_TTL_MS = 30_000
const PAGE_DRAG_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000
const PAGE_DRAG_MAX_RESOURCE_COUNT = 12
const PAGE_DRAG_MAX_FILE_BYTES = 512 * 1024 * 1024
const PAGE_DRAG_MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const PAGE_DRAG_MAX_INLINE_BYTES = 32 * 1024 * 1024
const PAGE_DRAG_STAGING_DIR_NAME = 'omniflow-import-staging'

type PageDragResource = EmbeddedBrowserPageDragFallbackResource & {
  requestHeaders?: Record<string, string>
  referer?: string
  sessionId?: string
  tabId?: string
}

type StoredPageDragSource = EmbeddedBrowserPageDragSource & {
  requestHeaders?: Record<string, string>
  referer?: string
}

type ReadPageBlobResult = {
  base64: string
  mimeType?: string
}

type StagePageDragOptions = {
  browserSession: Session
  readPageBlob: (tabId: string, sourceUrl: string, maxBytes: number) => Promise<ReadPageBlobResult>
}

const pageDragSessions = new Map<string, StoredPageDragSource>()
const latestPageDragSessionByTab = new Map<string, string>()
let lastStagingPruneAt = 0

const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/html': 'html',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

function getPageDragStagingRoot() {
  return path.join(app.getPath('temp'), PAGE_DRAG_STAGING_DIR_NAME)
}

function normalizeMimeType(value?: string | null) {
  return String(value || '').split(';')[0].trim().toLowerCase()
}

function normalizeSupportedUrl(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  try {
    const parsed = new URL(normalized)
    return ['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function normalizeReferrerUrl(value?: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  try {
    const parsed = new URL(normalized)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function sanitizeFileName(value: string, fallback: string) {
  const normalized = String(value || '').trim()
  const safeName = normalized ? normalizeDownloadFileName(normalized) : fallback
  const rawExtension = path.extname(safeName)
  const extension = Array.from(rawExtension).length <= 20 ? rawExtension : ''
  const maxStemLength = Math.max(1, 180 - extension.length)
  const stem = extension ? safeName.slice(0, -extension.length) : safeName
  return `${Array.from(stem).slice(0, maxStemLength).join('')}${extension}`
}

function decodeContentDispositionFileName(value: string) {
  const encodedMatch = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall through to the plain filename form.
    }
  }
  const plainMatch = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)
  return String(plainMatch?.[1] || plainMatch?.[2] || '').trim()
}

function fileNameFromUrl(value: string) {
  try {
    const parsed = new URL(value)
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
  } catch {
    return ''
  }
}

function ensureFileExtension(fileName: string, mimeType: string) {
  if (path.extname(fileName)) return fileName
  const extension = MIME_EXTENSIONS[mimeType]
  return extension ? `${fileName}.${extension}` : fileName
}

function reserveUniqueFileName(fileName: string, usedFileNames: Set<string>) {
  const extension = path.extname(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  let candidate = fileName
  let suffix = 2
  while (usedFileNames.has(candidate.toLowerCase())) {
    candidate = `${stem} (${suffix})${extension}`
    suffix += 1
  }
  usedFileNames.add(candidate.toLowerCase())
  return candidate
}

function resolveFileName(resource: PageDragResource, response: Response | null, index: number) {
  const mimeType = normalizeMimeType(response?.headers.get('content-type') || resource.mimeType)
  const contentDispositionName = decodeContentDispositionFileName(
    response?.headers.get('content-disposition') || '',
  )
  const candidate = contentDispositionName
    || resource.suggestedFileName
    || fileNameFromUrl(response?.url || resource.sourceUrl)
    || `web-resource-${index + 1}`
  return ensureFileExtension(
    sanitizeFileName(candidate, `web-resource-${index + 1}`),
    mimeType,
  )
}

function pruneExpiredSessions(now = Date.now()) {
  pageDragSessions.forEach((source, sessionId) => {
    if (now - source.capturedAt <= PAGE_DRAG_SESSION_TTL_MS) return
    pageDragSessions.delete(sessionId)
    if (latestPageDragSessionByTab.get(source.tabId) === sessionId) {
      latestPageDragSessionByTab.delete(source.tabId)
    }
  })
}

async function pruneStaleStagingDirectories() {
  const now = Date.now()
  if (now - lastStagingPruneAt < 60 * 60 * 1000) return
  lastStagingPruneAt = now
  const root = getPageDragStagingRoot()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith('page-drag-')) return
    const targetPath = path.join(root, entry.name)
    const targetStat = await stat(targetPath).catch(() => null)
    if (!targetStat || now - targetStat.mtimeMs <= PAGE_DRAG_STAGING_MAX_AGE_MS) return
    await rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
  }))
}

function normalizeSource(
  tabId: string,
  payload: Record<string, unknown>,
  enrichment?: { referer?: string; requestHeaders?: Record<string, string> },
): StoredPageDragSource | null {
  const sourceUrl = normalizeSupportedUrl(String(payload.sourceUrl || ''))
  const sessionId = String(payload.sessionId || '').trim().slice(0, 160)
  const normalizedTabId = String(tabId || payload.tabId || '').trim()
  if (!sourceUrl || !sessionId || !normalizedTabId) return null
  const sourceKind = ['image', 'link', 'media'].includes(String(payload.sourceKind))
    ? payload.sourceKind as EmbeddedBrowserPageDragSource['sourceKind']
    : 'unknown'
  return {
    capturedAt: Date.now(),
    mimeType: normalizeMimeType(String(payload.mimeType || '')) || undefined,
    pageUrl: normalizeReferrerUrl(String(payload.pageUrl || '')),
    referer: normalizeReferrerUrl(enrichment?.referer) || undefined,
    requestHeaders: enrichment?.requestHeaders,
    sessionId,
    sourceKind,
    sourceUrl,
    suggestedFileName: sanitizeFileName(String(payload.suggestedFileName || ''), '') || undefined,
    tabId: normalizedTabId,
  }
}

export function recordEmbeddedBrowserPageDragSource(
  tabId: string,
  payload: Record<string, unknown>,
  enrichment?: { referer?: string; requestHeaders?: Record<string, string> },
) {
  pruneExpiredSessions()
  const source = normalizeSource(tabId, payload, enrichment)
  if (!source) return null
  const previousSessionId = latestPageDragSessionByTab.get(source.tabId)
  if (previousSessionId && previousSessionId !== source.sessionId) {
    pageDragSessions.delete(previousSessionId)
  }
  pageDragSessions.set(source.sessionId, source)
  latestPageDragSessionByTab.set(source.tabId, source.sessionId)
  return source
}

export function clearEmbeddedBrowserPageDragSources(tabId?: string) {
  const normalizedTabId = String(tabId || '').trim()
  if (!normalizedTabId) {
    pageDragSessions.clear()
    latestPageDragSessionByTab.clear()
    return
  }
  pageDragSessions.forEach((source, sessionId) => {
    if (source.tabId === normalizedTabId) {
      pageDragSessions.delete(sessionId)
    }
  })
  latestPageDragSessionByTab.delete(normalizedTabId)
}

function consumePageDragSource(request: EmbeddedBrowserStagePageDragRequest) {
  pruneExpiredSessions()
  const requestedSessionId = String(request.sessionId || '').trim()
  const requestedTabId = String(request.tabId || '').trim()
  const fallbackUrls = new Set(
    (request.fallbackResources || [])
      .map((resource) => normalizeSupportedUrl(resource.sourceUrl))
      .filter(Boolean),
  )
  const latestSessionId = requestedTabId ? latestPageDragSessionByTab.get(requestedTabId) : ''
  const latestSource = latestSessionId ? pageDragSessions.get(latestSessionId) : null
  const fallbackSessionId = latestSource && fallbackUrls.has(latestSource.sourceUrl)
    ? latestSource.sessionId
    : ''
  const sessionId = requestedSessionId || fallbackSessionId || ''
  if (!sessionId) return null
  const source = pageDragSessions.get(sessionId) || null
  if (!source) {
    if (requestedSessionId && !(request.fallbackResources || []).length) {
      throw new Error('网页拖拽内容已过期，请重新拖拽')
    }
    return null
  }
  if (requestedTabId && source.tabId !== requestedTabId) {
    throw new Error('网页拖拽来源已切换，请重新拖拽')
  }
  pageDragSessions.delete(sessionId)
  if (latestPageDragSessionByTab.get(source.tabId) === sessionId) {
    latestPageDragSessionByTab.delete(source.tabId)
  }
  return source
}

function normalizeFallbackResources(resources: EmbeddedBrowserPageDragFallbackResource[]) {
  const seen = new Set<string>()
  return resources.slice(0, PAGE_DRAG_MAX_RESOURCE_COUNT).flatMap((resource) => {
    const sourceUrl = normalizeSupportedUrl(resource.sourceUrl)
    if (!sourceUrl || seen.has(sourceUrl)) return []
    seen.add(sourceUrl)
    return [{
      mimeType: normalizeMimeType(resource.mimeType) || undefined,
      pageUrl: normalizeReferrerUrl(resource.pageUrl) || undefined,
      sourceKind: resource.sourceKind,
      sourceUrl,
      suggestedFileName: sanitizeFileName(String(resource.suggestedFileName || ''), '') || undefined,
    }]
  })
}

function decodeDataUrl(sourceUrl: string) {
  const match = sourceUrl.match(/^data:([^,]*?),(.*)$/s)
  if (!match) throw new Error('网页内嵌资源格式无效')
  const metadata = match[1] || ''
  const encoded = match[2] || ''
  const mimeType = normalizeMimeType(metadata.split(';')[0]) || 'application/octet-stream'
  const buffer = /;base64(?:;|$)/i.test(metadata)
    ? Buffer.from(encoded, 'base64')
    : Buffer.from(decodeURIComponent(encoded), 'utf8')
  if (buffer.length > PAGE_DRAG_MAX_INLINE_BYTES) {
    throw new Error('网页内嵌资源超过 32MB，请先下载后再导入')
  }
  return { buffer, mimeType }
}

async function writeHttpResource(
  browserSession: Session,
  resource: PageDragResource,
  targetPath: string,
  remainingBytes: number,
) {
  const requestHeaders = Object.fromEntries(
    Object.entries(resource.requestHeaders || {}).filter(([headerName, headerValue]) => {
      const normalizedName = headerName.trim().toLowerCase()
      if (!normalizedName || !String(headerValue || '').trim()) return false
      return ![
        'accept-encoding',
        'connection',
        'content-length',
        'cookie',
        'host',
        'proxy-authorization',
        'proxy-connection',
        'referer',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
      ].includes(normalizedName) && !normalizedName.startsWith('sec-')
    }),
  )
  const response = await browserSession.fetch(resource.sourceUrl, {
    credentials: 'include',
    headers: {
      Accept: '*/*',
      ...requestHeaders,
    },
    ...(resource.referer || resource.pageUrl ? {
      referrer: resource.referer || resource.pageUrl,
      referrerPolicy: 'unsafe-url',
    } : {}),
  })
  if (!response.ok || !response.body) {
    throw new Error(`网页资源下载失败：HTTP ${response.status}`)
  }
  const responseMimeType = normalizeMimeType(response.headers.get('content-type'))
  if (
    resource.sourceKind === 'image'
    && responseMimeType
    && responseMimeType !== 'application/octet-stream'
    && !responseMimeType.startsWith('image/')
  ) {
    throw new Error(`拖拽图片返回了非图片内容：${responseMimeType}`)
  }
  if (
    resource.sourceKind === 'media'
    && responseMimeType
    && responseMimeType !== 'application/octet-stream'
    && !responseMimeType.startsWith('audio/')
    && !responseMimeType.startsWith('video/')
  ) {
    throw new Error(`拖拽媒体返回了非媒体内容：${responseMimeType}`)
  }
  const declaredLength = Number(response.headers.get('content-length') || 0)
  const maxBytes = Math.min(PAGE_DRAG_MAX_FILE_BYTES, remainingBytes)
  if (declaredLength > maxBytes) {
    throw new Error('网页资源过大，无法通过拖拽导入')
  }
  let receivedBytes = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += Buffer.byteLength(chunk)
      if (receivedBytes > maxBytes) {
        callback(new Error('网页资源过大，无法通过拖拽导入'))
        return
      }
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as any),
    limiter,
    createWriteStream(targetPath),
  )
  return {
    mimeType: responseMimeType || normalizeMimeType(resource.mimeType),
    response,
    size: receivedBytes,
  }
}

async function stageSingleResource(
  resource: PageDragResource,
  index: number,
  stagingPath: string,
  remainingBytes: number,
  options: StagePageDragOptions,
  usedFileNames: Set<string>,
) {
  const protocol = new URL(resource.sourceUrl).protocol
  let response: Response | null = null
  let mimeType = normalizeMimeType(resource.mimeType)
  let inlineBuffer: Buffer | null = null

  if (protocol === 'data:') {
    const decoded = decodeDataUrl(resource.sourceUrl)
    inlineBuffer = decoded.buffer
    mimeType = decoded.mimeType
  } else if (protocol === 'blob:') {
    if (!resource.tabId) {
      throw new Error('网页临时资源已失去原页面上下文，请重新拖拽')
    }
    const result = await options.readPageBlob(resource.tabId, resource.sourceUrl, PAGE_DRAG_MAX_INLINE_BYTES)
    inlineBuffer = Buffer.from(result.base64, 'base64')
    mimeType = normalizeMimeType(result.mimeType || resource.mimeType) || 'application/octet-stream'
    if (inlineBuffer.length > PAGE_DRAG_MAX_INLINE_BYTES) {
      throw new Error('网页临时资源超过 32MB，请先下载后再导入')
    }
  }

  const partPath = path.join(stagingPath, `.resource-${index + 1}.part`)

  let size = 0
  if (inlineBuffer) {
    if (inlineBuffer.length > remainingBytes) {
      throw new Error('本次拖拽资源总大小超过限制')
    }
    await writeFile(partPath, inlineBuffer)
    size = inlineBuffer.length
  } else {
    const result = await writeHttpResource(options.browserSession, resource, partPath, remainingBytes)
    response = result.response
    mimeType = result.mimeType
    size = result.size
  }

  const fileName = reserveUniqueFileName(
    resolveFileName({ ...resource, mimeType }, response, index),
    usedFileNames,
  )
  const filePath = path.join(stagingPath, fileName)
  await rename(partPath, filePath)
  return { fileName, filePath, mimeType, size }
}

export async function stageEmbeddedBrowserPageDrag(
  request: EmbeddedBrowserStagePageDragRequest,
  options: StagePageDragOptions,
): Promise<EmbeddedBrowserStagedPageDragFile[]> {
  await mkdir(getPageDragStagingRoot(), { recursive: true })
  void pruneStaleStagingDirectories()

  const capturedSource = consumePageDragSource(request)
  const resources: PageDragResource[] = capturedSource
    ? [{ ...capturedSource }]
    : normalizeFallbackResources(request.fallbackResources || []).map((resource) => ({
      ...resource,
      tabId: String(request.tabId || '').trim() || undefined,
    }))
  if (!resources.length) {
    throw new Error('没有识别到可导入的网页文件')
  }

  const stagingPath = await mkdtemp(path.join(getPageDragStagingRoot(), 'page-drag-'))
  const stagedFiles: EmbeddedBrowserStagedPageDragFile[] = []
  const usedFileNames = new Set<string>()
  let totalBytes = 0
  try {
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index]
      const staged = await stageSingleResource(
        resource,
        index,
        stagingPath,
        PAGE_DRAG_MAX_TOTAL_BYTES - totalBytes,
        options,
        usedFileNames,
      )
      totalBytes += staged.size
      stagedFiles.push({
        cleanupPath: stagingPath,
        fileName: staged.fileName,
        filePath: staged.filePath,
        mimeType: staged.mimeType || undefined,
        size: staged.size,
        sourceUrl: resource.sourceUrl,
      })
    }
    return stagedFiles
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function readEmbeddedBrowserPageBlob(
  view: WebContentsView,
  sourceUrl: string,
  maxBytes: number,
): Promise<ReadPageBlobResult> {
  if (view.webContents.isDestroyed()) {
    throw new Error('网页已关闭，请重新拖拽')
  }
  const script = `(async function(){
    try{
      var response=await fetch(${JSON.stringify(sourceUrl)});
      if(!response.ok)return null;
      var blob=await response.blob();
      if(blob.size>${Math.max(1, maxBytes)})throw new Error('too-large');
      var bytes=new Uint8Array(await blob.arrayBuffer());
      var binary='';
      var step=32768;
      for(var i=0;i<bytes.length;i+=step){
        binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+step,bytes.length)));
      }
      return{base64:btoa(binary),mimeType:blob.type||response.headers.get('content-type')||''};
    }catch(error){return null}
  })()`
  const mainFrame = view.webContents.mainFrame
  const frames = mainFrame
    ? [mainFrame, ...mainFrame.framesInSubtree.filter((frame) => frame !== mainFrame)]
    : []
  for (const frame of frames) {
    const result = await frame.executeJavaScript(script, true).catch(() => null) as ReadPageBlobResult | null
    if (result?.base64) return result
  }
  throw new Error('网页临时资源已失效，请重新拖拽')
}
