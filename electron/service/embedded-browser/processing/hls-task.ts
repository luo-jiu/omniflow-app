import os from 'node:os'
import path from 'node:path'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import {
  EmbeddedBrowserFragmentDownloader,
  type EmbeddedBrowserDownloadByteRange,
  type EmbeddedBrowserDownloadFragment,
  type EmbeddedBrowserFragmentBufferProcessor,
  type EmbeddedBrowserFragmentFetch,
} from '../../embeddedBrowserFragmentDownloader'
import { preprocessFragment } from '../cat-catch-port/hls/pipeline'

export type EmbeddedBrowserHlsLocalDownloadKeyRef = {
  iv?: string
  keyFormat?: string
  method: string
  url?: string
}

export type EmbeddedBrowserHlsLocalDownloadMapRef = {
  byteRange?: EmbeddedBrowserDownloadByteRange
  key?: EmbeddedBrowserHlsLocalDownloadKeyRef
  url: string
}

export type EmbeddedBrowserHlsLocalDownloadFragment = EmbeddedBrowserDownloadFragment & {
  discontinuitySequence: number
  initSegment?: EmbeddedBrowserHlsLocalDownloadMapRef
  key?: EmbeddedBrowserHlsLocalDownloadKeyRef
  outputRelativePath?: string
  part: boolean
  sequence: number
  sourceIndex?: number
  title?: string
}

export type EmbeddedBrowserHlsLocalDownloadPlan = {
  fragments: EmbeddedBrowserHlsLocalDownloadFragment[]
  headers?: Record<string, string>
  manifestUrl: string
  suggestedThreadCount?: number
}

export type EmbeddedBrowserHlsLocalDownloadRequest = {
  /** Cat Catch cache-fallback compatibility for image-prefixed media bytes. */
  preprocessFragments?: boolean
  fetch?: EmbeddedBrowserFragmentFetch
  fragmentIndexes?: number[]
  manualKeyBase64?: string
  maxRetries?: number
  signal?: AbortSignal
  onEvent?: (event: {
    bytesReceived?: number
    bytesTotal?: number
    completedFragments?: number
    etaSeconds?: number
    error?: string
    failedFragments?: number[]
    message: string
    speedBps?: number
    stage: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'completed' | 'error'
    status: 'running' | 'success' | 'error'
    totalFragments?: number
  }) => void
  outputDirectoryPath?: string
  plan: EmbeddedBrowserHlsLocalDownloadPlan
  workDirectoryPath?: string
}

export type EmbeddedBrowserHlsLocalDownloadResult = {
  downloadedFragmentCount: number
  keyCount: number
  mapCount: number
  playlistPath: string
  workDirectoryPath: string
}

function getFragmentSourceIndex(fragment: EmbeddedBrowserDownloadFragment | EmbeddedBrowserHlsLocalDownloadFragment) {
  if ('sourceIndex' in fragment && typeof fragment.sourceIndex === 'number') {
    return fragment.sourceIndex
  }
  return typeof fragment.index === 'number' ? fragment.index : -1
}

type ResourceRefRecord = {
  localPath: string
  playlistPath: string
}

function createHlsDownloadAbortError() {
  const error = new Error('HLS download aborted')
  error.name = 'AbortError'
  return error
}

function throwIfHlsDownloadAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createHlsDownloadAbortError()
  }
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

function getRequiredLocalRef<T extends ResourceRefRecord>(
  collectionName: 'key' | 'map',
  record: T | undefined,
  fragmentSequence: number,
) {
  if (record?.playlistPath) {
    return record
  }
  throw new Error(`重写本地 playlist 失败：分片序号 ${fragmentSequence} 缺少对应的本地${collectionName}文件`)
}

async function fetchStaticResourceBuffer(input: {
  byteRange?: EmbeddedBrowserDownloadByteRange
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  signal?: AbortSignal
  url: string
}) {
  const headers = new Headers(input.headers)
  const rangeHeader = createByteRangeHeader(input.byteRange)
  if (rangeHeader) {
    headers.set('Range', rangeHeader)
  }
  const response = await (input.fetch || ((url, init) => fetch(url, init)))(input.url, {
    headers,
    signal: input.signal,
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

async function downloadStaticResource(input: {
  byteRange?: EmbeddedBrowserDownloadByteRange
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  outputPath: string
  signal?: AbortSignal
  url: string
}) {
  const buffer = await fetchStaticResourceBuffer(input)
  await writeFile(input.outputPath, new Uint8Array(buffer))
}

async function prepareStaticRefs(input: {
  directoryName: 'keys' | 'maps'
  fetch?: EmbeddedBrowserFragmentFetch
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
  signal?: AbortSignal
}) {
  const records = new Map<string, ResourceRefRecord>()
  await mkdir(path.join(input.outputDirectoryPath, input.directoryName), {
    recursive: true,
  })

  let resourceIndex = 0
  for (const ref of input.refs) {
    throwIfHlsDownloadAborted(input.signal)
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
      fetch: input.fetch,
      headers: input.headers,
      outputPath: nextPaths.outputPath,
      signal: input.signal,
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
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  manualKeyBase64?: string
  outputDirectoryPath: string
  refs: Array<{
    method?: string
    url?: string
  }>
  signal?: AbortSignal
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
    throwIfHlsDownloadAborted(input.signal)
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
      const keyBuffer = await fetchStaticResourceBuffer({
        fetch: input.fetch,
        headers: input.headers,
        signal: input.signal,
        url: ref.url,
      })
      if (normalizedMethod === 'AES-128' && keyBuffer.byteLength !== 16) {
        throw new Error(`AES-128 key must be 16 bytes, received ${keyBuffer.byteLength}`)
      }
      await writeFile(outputPath, new Uint8Array(keyBuffer))
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
  if (!input.fragments.length || !input.fragmentPaths.length) {
    throw new Error('重写本地 playlist 失败：当前没有可写入 playlist 的本地分片')
  }
  const targetDuration = Math.max(
    1,
    Math.ceil(input.fragments.reduce((maxDuration, fragment) => (
      Math.max(maxDuration, Number(fragment.duration || 0))
    ), 0)),
  )
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
  ]

  let previousDiscontinuity = input.fragments[0]?.discontinuitySequence ?? 0
  let previousKeyStateKey = ''
  let previousMapStateKey = ''
  let hadKey = false

  function getKeyIdentity(key: EmbeddedBrowserHlsLocalDownloadKeyRef | undefined) {
    if (!key) return { refCacheKey: '', stateKey: '' }
    const refCacheKey = createKeyRefCacheKey({
      manualKeyBase64: input.manualKeyBase64,
      method: key.method,
      url: key.url,
    })
    return {
      refCacheKey,
      stateKey: `${refCacheKey}|${key.iv || ''}|${key.keyFormat || ''}`,
    }
  }

  function appendKeyTransition(
    key: EmbeddedBrowserHlsLocalDownloadKeyRef | undefined,
    fragmentSequence: number,
  ) {
    const { refCacheKey, stateKey } = getKeyIdentity(key)
    if (key && stateKey !== previousKeyStateKey) {
      const keyRecord = getRequiredLocalRef('key', input.keyRefs.get(refCacheKey), fragmentSequence)
      lines.push(createHlsKeyLine(key, keyRecord.playlistPath))
      previousKeyStateKey = stateKey
      hadKey = true
    } else if (!key && hadKey) {
      lines.push('#EXT-X-KEY:METHOD=NONE')
      previousKeyStateKey = ''
      hadKey = false
    }
  }

  input.fragments.forEach((fragment, index) => {
    if (index > 0 && fragment.discontinuitySequence !== previousDiscontinuity) {
      lines.push('#EXT-X-DISCONTINUITY')
      previousDiscontinuity = fragment.discontinuitySequence
    }

    const nextMapRefCacheKey = fragment.initSegment?.url
      ? createResourceCacheKey({
          byteRange: fragment.initSegment.byteRange,
          url: fragment.initSegment.url,
        })
      : ''
    const nextMapKeyState = getKeyIdentity(fragment.initSegment?.key).stateKey
    const nextMapStateKey = fragment.initSegment
      ? `${nextMapRefCacheKey}|${nextMapKeyState}`
      : ''
    if (fragment.initSegment && nextMapStateKey !== previousMapStateKey) {
      appendKeyTransition(fragment.initSegment.key, fragment.sequence)
      const mapRecord = getRequiredLocalRef('map', input.mapRefs.get(nextMapRefCacheKey), fragment.sequence)
      lines.push(createHlsMapLine(mapRecord.playlistPath))
      previousMapStateKey = nextMapStateKey
    }

    appendKeyTransition(fragment.key, fragment.sequence)

    const fragmentPath = input.fragmentPaths[index]
    if (!fragmentPath) {
      throw new Error(`重写本地 playlist 失败：分片序号 ${fragment.sequence} 缺少本地输出路径`)
    }
    lines.push(`#EXTINF:${fragment.duration || 0},${fragment.title || ''}`)
    lines.push(fragmentPath)
  })

  lines.push('#EXT-X-ENDLIST')
  return `${lines.filter(Boolean).join('\n')}\n`
}

async function filterExistingPlaylistFragments(input: {
  fragmentPaths: string[]
  fragments: EmbeddedBrowserHlsLocalDownloadFragment[]
  outputDirectoryPath: string
}) {
  const existence = await Promise.all(input.fragmentPaths.map(async (relativePath) => {
    try {
      await access(path.join(input.outputDirectoryPath, relativePath))
      return true
    } catch {
      return false
    }
  }))

  return input.fragments.reduce<{
    fragmentPaths: string[]
    fragments: EmbeddedBrowserHlsLocalDownloadFragment[]
  }>((accumulator, fragment, index) => {
    if (!existence[index]) {
      return accumulator
    }
    accumulator.fragments.push(fragment)
    accumulator.fragmentPaths.push(input.fragmentPaths[index] || '')
    return accumulator
  }, {
    fragmentPaths: [],
    fragments: [],
  })
}

async function downloadEmbeddedBrowserHlsToLocalWorkDirectory(
  request: EmbeddedBrowserHlsLocalDownloadRequest,
): Promise<EmbeddedBrowserHlsLocalDownloadResult> {
  throwIfHlsDownloadAborted(request.signal)
  const { plan } = request
  const requestedFragmentIndexes = Array.isArray(request.fragmentIndexes)
    ? new Set(request.fragmentIndexes.filter((value) => Number.isFinite(value) && value >= 0))
    : null
  request.onEvent?.({
    message: '开始准备本地 HLS 工作目录',
    stage: 'preparing',
    status: 'running',
    totalFragments: plan.fragments.length,
  })
  const outputDirectoryPath = request.workDirectoryPath
    ? path.resolve(request.workDirectoryPath)
    : request.outputDirectoryPath
    ? path.resolve(request.outputDirectoryPath)
    : await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-download-'))

  const segmentsDirectoryPath = path.join(outputDirectoryPath, 'segments')
  await mkdir(segmentsDirectoryPath, { recursive: true })

  const keyRefs = await prepareKeyRefs({
    fetch: request.fetch,
    headers: plan.headers,
    manualKeyBase64: request.manualKeyBase64,
    outputDirectoryPath,
    refs: plan.fragments.flatMap((fragment) => ([
      {
        method: fragment.initSegment?.key?.method,
        url: fragment.initSegment?.key?.url,
      },
      {
        method: fragment.key?.method,
        url: fragment.key?.url,
      },
    ])),
    signal: request.signal,
  })

  const mapRefs = await prepareStaticRefs({
    directoryName: 'maps',
    fetch: request.fetch,
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
    signal: request.signal,
  })

  const fragmentPaths = plan.fragments.map((fragment, index) => {
    const extension = inferExtensionFromUrl(fragment.url, fragment.part ? 'm4s' : 'ts')
    const fragmentIndex = typeof fragment.index === 'number' ? fragment.index : index
    const fileName = `${String(fragmentIndex + 1).padStart(5, '0')}.${extension}`
    return path.posix.join('segments', fileName)
  })
  const fragmentsToDownload = requestedFragmentIndexes
    ? plan.fragments
      .filter((fragment, index) => requestedFragmentIndexes.has(typeof fragment.index === 'number' ? fragment.index : index))
      .map((fragment) => {
        const sourceIndex = typeof fragment.index === 'number' ? fragment.index : plan.fragments.indexOf(fragment)
        return {
          ...fragment,
          outputRelativePath: fragmentPaths[sourceIndex],
          sourceIndex,
        }
      })
    : plan.fragments.map((fragment, index) => {
      const sourceIndex = typeof fragment.index === 'number' ? fragment.index : index
      return {
        ...fragment,
        outputRelativePath: fragmentPaths[sourceIndex],
        sourceIndex,
      }
    })
  const initialCompletedFragments = requestedFragmentIndexes
    ? (await Promise.all(fragmentPaths.map(async (relativePath, index): Promise<number> => {
      const sourceIndex = typeof plan.fragments[index]?.index === 'number'
        ? Number(plan.fragments[index]?.index)
        : index
      if (requestedFragmentIndexes.has(sourceIndex)) {
        return 0
      }
      try {
        await access(path.join(outputDirectoryPath, relativePath))
        return 1
      } catch {
        return 0
      }
    }))).reduce<number>((sum, value) => sum + value, 0)
    : 0

  const downloader = new EmbeddedBrowserFragmentDownloader({
    bufferProcessors: request.preprocessFragments
      ? [preprocessFragment as EmbeddedBrowserFragmentBufferProcessor]
      : undefined,
    fetch: request.fetch,
    fragments: fragmentsToDownload,
    headers: plan.headers,
    maxRetries: request.maxRetries,
    thread: plan.suggestedThreadCount || 6,
  })

  const pendingWrites: Array<{
    promise: Promise<void>
    sourceIndex: number
  }> = []
  let downloadError: Error | null = null
  let downloadErrorMessage = ''
  const fragmentReceivedBytes = new Map<number, number>()
  const fragmentTotalBytes = new Map<number, number>()
  const downloadStartedAt = Date.now()
  let lastProgressEmitAt = 0

  const emitDownloadProgress = (force = false) => {
    const now = Date.now()
    if (!force && now - lastProgressEmitAt < 220) {
      return
    }
    lastProgressEmitAt = now
    const bytesReceived = Array.from(fragmentReceivedBytes.values()).reduce((sum, value) => sum + value, 0)
    const bytesTotal = Array.from(fragmentTotalBytes.values()).reduce((sum, value) => sum + value, 0)
    const elapsedSeconds = Math.max((now - downloadStartedAt) / 1000, 0.001)
    const speedBps = bytesReceived > 0 ? bytesReceived / elapsedSeconds : 0
    const etaSeconds = bytesTotal > 0 && speedBps > 0
      ? Math.max(0, Math.round((bytesTotal - bytesReceived) / speedBps))
      : undefined
    request.onEvent?.({
      bytesReceived,
      bytesTotal: bytesTotal > 0 ? bytesTotal : undefined,
      completedFragments: initialCompletedFragments + downloader.success,
      etaSeconds,
      message: '',
      speedBps: speedBps > 0 ? speedBps : undefined,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: plan.fragments.length,
    })
  }

  request.onEvent?.({
    completedFragments: initialCompletedFragments,
    message: requestedFragmentIndexes?.size
      ? `开始重试 ${fragmentsToDownload.length} 个失败分片`
      : '开始下载 HLS 分片',
    stage: 'downloading-fragments',
    status: 'running',
    totalFragments: plan.fragments.length,
  })
  downloader.on('downloadError', (fragment, error, attempt) => {
    const sourceIndex = Math.max(0, getFragmentSourceIndex(fragment))
    request.onEvent?.({
      completedFragments: initialCompletedFragments + downloader.success,
      error: error.message,
      message: `分片 #${sourceIndex + 1} 第 ${attempt} 次下载失败：${error.message}`,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: plan.fragments.length,
    })
    if (downloadError || attempt <= (request.maxRetries || 2)) {
      return
    }
    downloadErrorMessage = `下载分片失败：#${sourceIndex + 1} ${error.message}`
    downloadError = new Error(downloadErrorMessage)
  })
  downloader.on('itemProgress', (fragment, done, receivedLength, contentLength) => {
    const sourceIndex = Math.max(0, getFragmentSourceIndex(fragment))
    fragmentReceivedBytes.set(sourceIndex, receivedLength)
    const knownTotal = fragment.byteRange?.length || contentLength || fragmentTotalBytes.get(sourceIndex) || 0
    if (knownTotal > 0) {
      fragmentTotalBytes.set(sourceIndex, knownTotal)
    }
    emitDownloadProgress(done)
  })
  downloader.on('sequentialPush', (buffer, fragment) => {
    const hlsFragment = fragment as EmbeddedBrowserHlsLocalDownloadFragment
    const sourceIndex = getFragmentSourceIndex(fragment)
    const relativePath = hlsFragment.outputRelativePath || (sourceIndex >= 0 ? fragmentPaths[sourceIndex] : undefined)
    if (!relativePath) {
      return
    }
    pendingWrites.push({
      promise: writeFile(
        path.join(outputDirectoryPath, relativePath),
        new Uint8Array(buffer),
      ),
      sourceIndex,
    })
    request.onEvent?.({
      completedFragments: Math.min(plan.fragments.length, initialCompletedFragments + downloader.success + 1),
      message: `已写入分片 #${sourceIndex + 1}`,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: plan.fragments.length,
    })
  })

  if (request.signal?.aborted) {
    downloader.destroy()
    throw createHlsDownloadAbortError()
  }

  let abortListener: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      downloader.on('allCompleted', () => {
        resolve()
      })
      downloader.on('aborted', () => {
        reject(createHlsDownloadAbortError())
      })
      downloader.on('error', (message) => {
        reject(new Error(message))
      })
      downloader.on('failed', (_, errors) => {
        const firstErrorFragment = Array.from(errors)[0]
        const fragmentIndex = firstErrorFragment
          ? Math.max(0, getFragmentSourceIndex(firstErrorFragment))
          : 0
        reject(downloadError || new Error(`下载分片失败：#${fragmentIndex + 1}`))
      })
      abortListener = () => {
        downloader.stop()
      }
      request.signal?.addEventListener('abort', abortListener, { once: true })
      if (request.signal?.aborted) {
        downloader.stop()
        return
      }
      downloader.start()
    })
  } finally {
    if (abortListener) {
      request.signal?.removeEventListener('abort', abortListener)
    }
    downloader.destroy()
  }

  const pendingWriteResults = await Promise.allSettled(
    pendingWrites.map((entry) => entry.promise),
  )
  const completedWrittenFragments = pendingWriteResults.reduce<number>((sum, result) => (
    result.status === 'fulfilled' ? sum + 1 : sum
  ), 0)
  const failedWriteFragments = pendingWriteResults.reduce<number[]>((accumulator, result, index) => {
    if (result.status === 'rejected') {
      const sourceIndex = pendingWrites[index]?.sourceIndex
      if (typeof sourceIndex === 'number' && sourceIndex >= 0) {
        accumulator.push(sourceIndex + 1)
      }
    }
    return accumulator
  }, [])
  if (failedWriteFragments.length > 0) {
    const failureMessage = `写入分片失败：${failedWriteFragments.map((value) => `#${value}`).join(', ')}`
    request.onEvent?.({
      completedFragments: initialCompletedFragments + completedWrittenFragments,
      error: failureMessage,
      failedFragments: failedWriteFragments,
      message: failureMessage,
      stage: 'error',
      status: 'error',
      totalFragments: plan.fragments.length,
    })
    throw new Error(failureMessage)
  }
  emitDownloadProgress(true)
  if (downloadError || downloader.errorItem.size > 0) {
    const failureMessage = downloadErrorMessage || `仍有 ${downloader.errorItem.size} 个分片下载失败`
    request.onEvent?.({
      completedFragments: initialCompletedFragments + downloader.success,
      error: failureMessage,
      failedFragments: Array.from(downloader.errorItem)
        .map((fragment) => getFragmentSourceIndex(fragment) + 1)
        .filter((value) => value > 0),
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
  const existingPlaylistContent = await filterExistingPlaylistFragments({
    fragmentPaths,
    fragments: plan.fragments,
    outputDirectoryPath,
  })
  const playlistText = buildLocalPlaylist({
    fragmentPaths: existingPlaylistContent.fragmentPaths,
    fragments: existingPlaylistContent.fragments,
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

export class HlsTaskExecutor {
  downloadToLocalWorkDirectory(request: EmbeddedBrowserHlsLocalDownloadRequest) {
    return downloadEmbeddedBrowserHlsToLocalWorkDirectory(request)
  }
}

export const defaultHlsTaskExecutor = new HlsTaskExecutor()

export const downloadHlsToLocalWorkDirectory = (
  defaultHlsTaskExecutor.downloadToLocalWorkDirectory.bind(defaultHlsTaskExecutor)
)
