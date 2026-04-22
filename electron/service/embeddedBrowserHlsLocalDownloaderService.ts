import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import {
  EmbeddedBrowserFragmentDownloader,
  type EmbeddedBrowserDownloadByteRange,
  type EmbeddedBrowserDownloadFragment,
} from './embeddedBrowserFragmentDownloader'

export type EmbeddedBrowserHlsLocalDownloadKeyRef = {
  iv?: string
  keyFormat?: string
  method: string
  url?: string
}

export type EmbeddedBrowserHlsLocalDownloadMapRef = {
  byteRange?: EmbeddedBrowserDownloadByteRange
  url: string
}

export type EmbeddedBrowserHlsLocalDownloadFragment = EmbeddedBrowserDownloadFragment & {
  discontinuitySequence: number
  initSegment?: EmbeddedBrowserHlsLocalDownloadMapRef
  key?: EmbeddedBrowserHlsLocalDownloadKeyRef
  part: boolean
  sequence: number
  title?: string
}

export type EmbeddedBrowserHlsLocalDownloadPlan = {
  fragments: EmbeddedBrowserHlsLocalDownloadFragment[]
  headers?: Record<string, string>
  manifestUrl: string
  suggestedThreadCount?: number
}

export type EmbeddedBrowserHlsLocalDownloadRequest = {
  manualKeyBase64?: string
  maxRetries?: number
  onEvent?: (event: {
    completedFragments?: number
    error?: string
    message: string
    stage: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'completed' | 'error'
    status: 'running' | 'success' | 'error'
    totalFragments?: number
  }) => void
  outputDirectoryPath?: string
  plan: EmbeddedBrowserHlsLocalDownloadPlan
}

export type EmbeddedBrowserHlsLocalDownloadResult = {
  downloadedFragmentCount: number
  keyCount: number
  mapCount: number
  playlistPath: string
  workDirectoryPath: string
}

type ResourceRefRecord = {
  localPath: string
  playlistPath: string
}

function normalizeManualAes128KeyBase64(base64: string | undefined) {
  const normalizedBase64 = String(base64 || '').trim()
  if (!normalizedBase64) {
    return null
  }
  try {
    const decoded = Buffer.from(normalizedBase64, 'base64')
    return decoded.byteLength === 16 ? decoded.toString('base64') : null
  } catch {
    return null
  }
}

function createByteRangeHeader(byteRange?: EmbeddedBrowserDownloadByteRange) {
  if (!byteRange || byteRange.length <= 0) {
    return undefined
  }
  const start = Math.max(0, Number(byteRange.offset || 0))
  const end = start + Math.max(0, Number(byteRange.length || 0)) - 1
  return `bytes=${start}-${end}`
}

function createResourceCacheKey(input: {
  byteRange?: EmbeddedBrowserDownloadByteRange
  method?: string
  url?: string
}) {
  return [
    String(input.method || ''),
    String(input.url || ''),
    input.byteRange?.raw || '',
    String(input.byteRange?.length || ''),
    String(input.byteRange?.offset || ''),
  ].join('|')
}

function createKeyRefCacheKey(input: {
  manualKeyBase64?: string
  method?: string
  url?: string
}) {
  const normalizedMethod = String(input.method || '').trim().toUpperCase()
  if (input.manualKeyBase64 && normalizedMethod === 'AES-128') {
    return `manual:${input.manualKeyBase64}:${normalizedMethod}`
  }
  return createResourceCacheKey({
    method: normalizedMethod,
    url: input.url,
  })
}

function inferExtensionFromUrl(input: string, fallback: string) {
  try {
    const extension = path.extname(new URL(input).pathname || '').replace(/^\./, '').trim()
    return extension || fallback
  } catch {
    const extension = path.extname(String(input || '')).replace(/^\./, '').trim()
    return extension || fallback
  }
}

function createHlsKeyLine(ref: EmbeddedBrowserHlsLocalDownloadKeyRef | undefined, uri: string) {
  if (!ref) {
    return '#EXT-X-KEY:METHOD=NONE'
  }
  const attributes = [
    `METHOD=${ref.method || 'NONE'}`,
    `URI="${uri}"`,
  ]
  if (ref.iv) {
    attributes.push(`IV=${ref.iv}`)
  }
  if (ref.keyFormat) {
    attributes.push(`KEYFORMAT="${ref.keyFormat}"`)
  }
  return `#EXT-X-KEY:${attributes.join(',')}`
}

function createHlsMapLine(uri: string) {
  return `#EXT-X-MAP:URI="${uri}"`
}

async function downloadStaticResource(input: {
  byteRange?: EmbeddedBrowserDownloadByteRange
  headers?: Record<string, string>
  outputPath: string
  url: string
}) {
  const headers = new Headers(input.headers)
  const rangeHeader = createByteRangeHeader(input.byteRange)
  if (rangeHeader) {
    headers.set('Range', rangeHeader)
  }
  const response = await fetch(input.url, {
    headers,
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  await writeFile(input.outputPath, new Uint8Array(buffer))
}

async function prepareStaticRefs(input: {
  directoryName: 'keys' | 'maps'
  outputDirectoryPath: string
  refs: Array<{
    byteRange?: EmbeddedBrowserDownloadByteRange
    method?: string
    url?: string
  }>
  resourcePathBuilder: (index: number, ref: { url?: string }) => {
    localPath: string
    outputPath: string
  }
  headers?: Record<string, string>
}) {
  const records = new Map<string, ResourceRefRecord>()
  await mkdir(path.join(input.outputDirectoryPath, input.directoryName), {
    recursive: true,
  })

  let resourceIndex = 0
  for (const ref of input.refs) {
    if (!ref.url) {
      continue
    }
    const cacheKey = createResourceCacheKey(ref)
    if (records.has(cacheKey)) {
      continue
    }
    const nextPaths = input.resourcePathBuilder(resourceIndex, ref)
    resourceIndex += 1
    await downloadStaticResource({
      byteRange: ref.byteRange,
      headers: input.headers,
      outputPath: nextPaths.outputPath,
      url: ref.url,
    })
    records.set(cacheKey, {
      localPath: nextPaths.outputPath,
      playlistPath: nextPaths.localPath,
    })
  }

  return records
}

async function prepareKeyRefs(input: {
  headers?: Record<string, string>
  manualKeyBase64?: string
  outputDirectoryPath: string
  refs: Array<{
    method?: string
    url?: string
  }>
}) {
  const records = new Map<string, ResourceRefRecord>()
  const keysDirectoryPath = path.join(input.outputDirectoryPath, 'keys')
  await mkdir(keysDirectoryPath, { recursive: true })

  const normalizedManualKeyBase64 = normalizeManualAes128KeyBase64(input.manualKeyBase64)
  const manualKeyBytes = normalizedManualKeyBase64
    ? Buffer.from(normalizedManualKeyBase64, 'base64')
    : null

  let resourceIndex = 0
  for (const ref of input.refs) {
    const normalizedMethod = String(ref.method || '').trim().toUpperCase()
    if (!normalizedMethod || normalizedMethod === 'NONE') {
      continue
    }
    const cacheKey = createKeyRefCacheKey({
      manualKeyBase64: normalizedManualKeyBase64 || undefined,
      method: normalizedMethod,
      url: ref.url,
    })
    if (records.has(cacheKey)) {
      continue
    }

    const extension = normalizedMethod === 'AES-128' ? 'key' : inferExtensionFromUrl(ref.url || '', 'key')
    const fileName = `key-${String(resourceIndex + 1).padStart(3, '0')}.${extension}`
    resourceIndex += 1
    const outputPath = path.join(keysDirectoryPath, fileName)

    if (manualKeyBytes && normalizedMethod === 'AES-128') {
      await writeFile(outputPath, manualKeyBytes)
    } else if (ref.url) {
      await downloadStaticResource({
        headers: input.headers,
        outputPath,
        url: ref.url,
      })
    } else {
      continue
    }

    records.set(cacheKey, {
      localPath: path.posix.join('keys', fileName),
      playlistPath: path.posix.join('keys', fileName),
    })
  }

  return records
}

function buildLocalPlaylist(input: {
  fragmentPaths: string[]
  fragments: EmbeddedBrowserHlsLocalDownloadFragment[]
  keyRefs: Map<string, ResourceRefRecord>
  manualKeyBase64?: string
  mapRefs: Map<string, ResourceRefRecord>
}) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3']
  if (input.fragments[0]) {
    lines.push(`#EXT-X-MEDIA-SEQUENCE:${input.fragments[0].sequence}`)
  }

  let previousDiscontinuity = input.fragments[0]?.discontinuitySequence ?? 0
  let previousKeyCacheKey = ''
  let previousMapCacheKey = ''
  let hadKey = false

  input.fragments.forEach((fragment, index) => {
    if (index > 0 && fragment.discontinuitySequence !== previousDiscontinuity) {
      lines.push('#EXT-X-DISCONTINUITY')
      previousDiscontinuity = fragment.discontinuitySequence
    }

    const nextKeyCacheKey = fragment.key
      ? createKeyRefCacheKey({
          manualKeyBase64: input.manualKeyBase64,
          method: fragment.key.method,
          url: fragment.key.url,
        })
      : ''
    if (fragment.key && nextKeyCacheKey !== previousKeyCacheKey) {
      const keyRecord = input.keyRefs.get(nextKeyCacheKey)
      if (keyRecord) {
        lines.push(createHlsKeyLine(fragment.key, keyRecord.playlistPath))
        previousKeyCacheKey = nextKeyCacheKey
        hadKey = true
      }
    } else if (!fragment.key && hadKey) {
      lines.push('#EXT-X-KEY:METHOD=NONE')
      previousKeyCacheKey = ''
      hadKey = false
    }

    const nextMapCacheKey = fragment.initSegment?.url
      ? createResourceCacheKey({
          byteRange: fragment.initSegment.byteRange,
          url: fragment.initSegment.url,
        })
      : ''
    if (fragment.initSegment && nextMapCacheKey !== previousMapCacheKey) {
      const mapRecord = input.mapRefs.get(nextMapCacheKey)
      if (mapRecord) {
        lines.push(createHlsMapLine(mapRecord.playlistPath))
        previousMapCacheKey = nextMapCacheKey
      }
    }

    lines.push(`#EXTINF:${fragment.duration || 0},${fragment.title || ''}`)
    lines.push(input.fragmentPaths[index] || '')
  })

  lines.push('#EXT-X-ENDLIST')
  return `${lines.filter(Boolean).join('\n')}\n`
}

export async function downloadEmbeddedBrowserHlsToLocalWorkDirectory(
  request: EmbeddedBrowserHlsLocalDownloadRequest,
): Promise<EmbeddedBrowserHlsLocalDownloadResult> {
  const { plan } = request
  request.onEvent?.({
    message: '开始准备本地 HLS 工作目录',
    stage: 'preparing',
    status: 'running',
    totalFragments: plan.fragments.length,
  })
  const outputDirectoryPath = request.outputDirectoryPath
    ? path.resolve(request.outputDirectoryPath)
    : await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-download-'))

  const segmentsDirectoryPath = path.join(outputDirectoryPath, 'segments')
  await mkdir(segmentsDirectoryPath, { recursive: true })

  const keyRefs = await prepareKeyRefs({
    headers: plan.headers,
    manualKeyBase64: request.manualKeyBase64,
    outputDirectoryPath,
    refs: plan.fragments.map((fragment) => ({
      method: fragment.key?.method,
      url: fragment.key?.url,
    })),
  })

  const mapRefs = await prepareStaticRefs({
    directoryName: 'maps',
    headers: plan.headers,
    outputDirectoryPath,
    refs: plan.fragments.map((fragment) => ({
      byteRange: fragment.initSegment?.byteRange,
      url: fragment.initSegment?.url,
    })),
    resourcePathBuilder: (index, ref) => {
      const extension = inferExtensionFromUrl(ref.url || '', 'bin')
      const fileName = `map-${String(index + 1).padStart(3, '0')}.${extension}`
      return {
        localPath: path.posix.join('maps', fileName),
        outputPath: path.join(outputDirectoryPath, 'maps', fileName),
      }
    },
  })

  const fragmentPaths = plan.fragments.map((fragment, index) => {
    const extension = inferExtensionFromUrl(fragment.url, fragment.part ? 'm4s' : 'ts')
    const fragmentIndex = typeof fragment.index === 'number' ? fragment.index : index
    const fileName = `${String(fragmentIndex + 1).padStart(5, '0')}.${extension}`
    return path.posix.join('segments', fileName)
  })

  const downloader = new EmbeddedBrowserFragmentDownloader({
    fragments: plan.fragments,
    headers: plan.headers,
    maxRetries: request.maxRetries,
    thread: plan.suggestedThreadCount || 6,
  })

  const pendingWrites: Promise<void>[] = []
  let downloadError: Error | null = null
  let downloadErrorMessage = ''
  request.onEvent?.({
    completedFragments: 0,
    message: '开始下载 HLS 分片',
    stage: 'downloading-fragments',
    status: 'running',
    totalFragments: plan.fragments.length,
  })
  downloader.on('downloadError', (fragment, error, attempt) => {
    request.onEvent?.({
      completedFragments: downloader.success,
      error: error.message,
      message: `分片 #${(fragment.index || 0) + 1} 第 ${attempt} 次下载失败：${error.message}`,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: plan.fragments.length,
    })
    if (downloadError || attempt <= (request.maxRetries || 2)) {
      return
    }
    const fragmentIndex = typeof fragment.index === 'number' ? fragment.index : 0
    downloadErrorMessage = `下载分片失败：#${fragmentIndex + 1} ${error.message}`
    downloadError = new Error(downloadErrorMessage)
  })
  downloader.on('sequentialPush', (buffer, fragment) => {
    const fragmentIndex = typeof fragment.index === 'number' ? fragment.index : -1
    const relativePath = fragmentIndex >= 0 ? fragmentPaths[fragmentIndex] : undefined
    if (!relativePath) {
      return
    }
    pendingWrites.push(writeFile(
      path.join(outputDirectoryPath, relativePath),
      new Uint8Array(buffer),
    ))
    request.onEvent?.({
      completedFragments: fragmentIndex + 1,
      message: `已写入分片 #${fragmentIndex + 1}`,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: plan.fragments.length,
    })
  })

  await new Promise<void>((resolve, reject) => {
    downloader.on('allCompleted', () => {
      resolve()
    })
    downloader.on('error', (message) => {
      reject(new Error(message))
    })
    downloader.on('failed', (_, errors) => {
      const firstErrorFragment = Array.from(errors)[0]
      const fragmentIndex = typeof firstErrorFragment?.index === 'number'
        ? firstErrorFragment.index
        : 0
      reject(downloadError || new Error(`下载分片失败：#${fragmentIndex + 1}`))
    })
    downloader.start()
  })

  await Promise.all(pendingWrites)
  if (downloadError || downloader.errorItem.size > 0) {
    const failureMessage = downloadErrorMessage || `仍有 ${downloader.errorItem.size} 个分片下载失败`
    request.onEvent?.({
      completedFragments: downloader.success,
      error: failureMessage,
      message: failureMessage,
      stage: 'error',
      status: 'error',
      totalFragments: plan.fragments.length,
    })
    throw downloadError || new Error(failureMessage)
  }

  request.onEvent?.({
    completedFragments: plan.fragments.length,
    message: '开始重写本地 playlist',
    stage: 'rewriting-playlist',
    status: 'running',
    totalFragments: plan.fragments.length,
  })
  const playlistText = buildLocalPlaylist({
    fragmentPaths,
    fragments: plan.fragments,
    keyRefs,
    manualKeyBase64: request.manualKeyBase64,
    mapRefs,
  })
  const playlistPath = path.join(outputDirectoryPath, 'local-playlist.m3u8')
  await writeFile(playlistPath, playlistText, 'utf8')

  request.onEvent?.({
    completedFragments: plan.fragments.length,
    message: '本地 playlist 重写完成',
    stage: 'rewriting-playlist',
    status: 'running',
    totalFragments: plan.fragments.length,
  })

  return {
    downloadedFragmentCount: plan.fragments.length,
    keyCount: keyRefs.size,
    mapCount: mapRefs.size,
    playlistPath,
    workDirectoryPath: outputDirectoryPath,
  }
}
