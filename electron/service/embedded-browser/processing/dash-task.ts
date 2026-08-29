/**
 * Main-side DASH transfer and merge owner.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/mpd.js#showSegment and lib/mpd-parser.min.js#parse
 * Reason: selected init/media segments must be fetched in parallel but
 * written in manifest order, while DRM and unbounded dynamic plans must not
 * be handed to a finite file task.
 * Adaptation: fetch and merge are injected so the task can redeem the main
 * browser session and use the existing ffmpeg owner without exposing headers
 * to renderer code.
 * Fixtures: dash.negative-repeat, dash.download-merge-cancel,
 * dash.dynamic-drm-rejection
 */

import { access, appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  DashRepresentation,
  DashSegment,
} from '../cat-catch-port/dash/parser'
import {
  parseDashSidxReferences,
} from '../cat-catch-port/dash/sidx'
import {
  EmbeddedBrowserFragmentDownloader,
  type EmbeddedBrowserDownloadFragment,
  type EmbeddedBrowserFragmentFetch,
} from '../../embeddedBrowserFragmentDownloader'

export type DashTaskPlan = {
  durationSeconds?: number
  hasDrm: boolean
  headers?: Record<string, string>
  isDynamic?: boolean
  manifestUrl: string
  minimumUpdatePeriodSeconds?: number
  representations: DashRepresentation[]
  unsupportedReasons?: string[]
}

export type DashTaskTrackFile = {
  path: string
  representation: DashRepresentation
}

export type DashTaskMergeInput = {
  audio?: DashTaskTrackFile
  outputPath: string
  signal: AbortSignal
  video?: DashTaskTrackFile
}

export type DashTaskMergeResult = {
  ffmpegPath?: string
  outputPath: string
}

export type DashTaskResult = {
  ffmpegPath?: string
  outputPath: string
  workDirectoryPath: string
}

export type DashTaskEvent = {
  completedFragments?: number
  message: string
  stage: 'preparing' | 'downloading' | 'merging' | 'completed' | 'error'
  status: 'running' | 'success' | 'error'
  totalFragments?: number
}

export type DashTaskExecutorOptions = {
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  maxRetries?: number
  mergeTracks: (input: DashTaskMergeInput) => Promise<DashTaskMergeResult>
  onEvent?: (event: DashTaskEvent) => void
  outputPath: string
  plan: DashTaskPlan
  selectedAudioRepresentation?: DashRepresentation
  selectedVideoRepresentation?: DashRepresentation
  signal?: AbortSignal
  threadCount?: number
  workDirectoryPath?: string
}

function createDashAbortError() {
  const error = new Error('DASH download aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw createDashAbortError()
}

function createFragments(representation: DashRepresentation): EmbeddedBrowserDownloadFragment[] {
  const fragments: EmbeddedBrowserDownloadFragment[] = []
  if (representation.initializationUrl) {
    fragments.push({
      byteRange: representation.initializationRange,
      index: 0,
      url: representation.initializationUrl,
    })
  }
  representation.segments.forEach((segment: DashSegment) => {
    if (!String(segment.url || '').trim()) {
      throw new Error(`DASH Representation ${representation.id} 包含空分片 URL`)
    }
    fragments.push({
      byteRange: segment.byteRange,
      duration: segment.duration,
      index: fragments.length,
      url: segment.url,
    })
  })
  if (!fragments.length) {
    throw new Error(`DASH Representation ${representation.id} 没有可下载的 init segment 或媒体分片`)
  }
  return fragments
}

const MAX_SIDX_NESTING_DEPTH = 8

function createSidxRange(offset: number, length: number) {
  const end = offset + length - 1
  if (!Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(length) || length <= 0
    || !Number.isSafeInteger(end) || end < offset) {
    throw new Error('DASH SIDX range 无效')
  }
  return { length, offset, raw: `${offset}-${end}` }
}

async function fetchSidxRange(
  representation: DashRepresentation,
  range: ReturnType<typeof createSidxRange>,
  options: {
    fetch?: EmbeddedBrowserFragmentFetch
    headers?: Record<string, string>
    signal: AbortSignal
  },
) {
  const headers = new Headers(options.headers)
  headers.set('Range', `bytes=${range.offset}-${range.offset + range.length - 1}`)
  const fetchImpl = options.fetch || ((input: string, init?: RequestInit) => fetch(input, init))
  const response = await fetchImpl(representation.baseUrls[0] || '', {
    headers,
    signal: options.signal,
  })
  if (response.status >= 400) {
    throw new Error(`DASH Representation ${representation.id} 的 SIDX 请求失败：HTTP ${response.status}`)
  }
  const responseBytes = new Uint8Array(await response.arrayBuffer())
  const contentRangeStart = Number.parseInt(
    /^bytes\s+(\d+)-/i.exec(response.headers.get('content-range') || '')?.[1] || '',
    10,
  )
  if (responseBytes.byteLength <= range.length) return responseBytes
  const sourceOffset = Number.isFinite(contentRangeStart) && contentRangeStart === range.offset
    ? 0
    : range.offset
  if (sourceOffset + range.length > responseBytes.byteLength) {
    throw new Error(`DASH Representation ${representation.id} 的 SIDX 响应长度不足`)
  }
  return responseBytes.slice(sourceOffset, sourceOffset + range.length)
}

async function expandSidxReferences(
  representation: DashRepresentation,
  bytes: Uint8Array,
  range: ReturnType<typeof createSidxRange>,
  options: {
    fetch?: EmbeddedBrowserFragmentFetch
    headers?: Record<string, string>
    presentationTimeOffset?: number
    signal: AbortSignal
  },
  depth = 0,
): Promise<DashSegment[]> {
  throwIfAborted(options.signal)
  const parsed = parseDashSidxReferences({
    baseUrl: representation.baseUrls[0] || '',
    bytes,
    indexRange: range,
    presentationTimeOffset: options.presentationTimeOffset,
  })
  const segments: DashSegment[] = []
  for (const reference of parsed.references) {
    throwIfAborted(options.signal)
    if (reference.referenceType === 1) {
      if (depth >= MAX_SIDX_NESTING_DEPTH) {
        throw new Error(`DASH Representation ${representation.id} 的 SIDX 嵌套层级超过限制`)
      }
      const nestedRange = createSidxRange(reference.mediaOffset, reference.referencedSize)
      const nestedBytes = await fetchSidxRange(representation, nestedRange, options)
      const nestedSegments = await expandSidxReferences(
        representation,
        nestedBytes,
        nestedRange,
        options,
        depth + 1,
      )
      const firstNestedTime = nestedSegments[0]?.time
      const timeOffset = firstNestedTime === undefined
        ? 0
        : reference.time - firstNestedTime
      nestedSegments.forEach(segment => {
        segments.push({
          ...segment,
          index: segments.length,
          time: segment.time === undefined ? undefined : segment.time + timeOffset,
        })
      })
      continue
    }
    const end = reference.mediaOffset + reference.referencedSize - 1
    segments.push({
      byteRange: {
        length: reference.referencedSize,
        offset: reference.mediaOffset,
        raw: `${reference.mediaOffset}-${end}`,
      },
      duration: reference.subsegmentDuration / parsed.timescale,
      index: segments.length,
      time: reference.time,
      url: representation.baseUrls[0] || '',
    })
  }
  if (!segments.length) throw new Error('DASH SIDX 无法解析：no media references')
  return segments
}

async function expandSegmentBaseRepresentation(
  representation: DashRepresentation,
  options: {
    fetch?: EmbeddedBrowserFragmentFetch
    headers?: Record<string, string>
    signal: AbortSignal
  },
) {
  const segmentBase = representation.segmentBase
  if (!segmentBase) return representation
  const range = createSidxRange(segmentBase.indexRange.offset, segmentBase.indexRange.length)
  const indexBytes = await fetchSidxRange(representation, range, options)
  const segments = await expandSidxReferences(representation, indexBytes, range, {
    ...options,
    presentationTimeOffset: segmentBase.presentationTimeOffset,
  })
  return {
    ...representation,
    segmentCount: segments.length,
    segments,
  }
}

async function downloadRepresentation(
  representation: DashRepresentation,
  outputPath: string,
  options: {
    fetch?: EmbeddedBrowserFragmentFetch
    headers?: Record<string, string>
    maxRetries: number
    signal: AbortSignal
    threadCount: number
  },
) {
  const resolvedRepresentation = await expandSegmentBaseRepresentation(representation, options)
  const fragments = createFragments(resolvedRepresentation)
  throwIfAborted(options.signal)
  await writeFile(outputPath, Buffer.alloc(0))
  const downloader = new EmbeddedBrowserFragmentDownloader({
    fetch: options.fetch,
    fragments,
    headers: options.headers,
    maxRetries: options.maxRetries,
    thread: options.threadCount,
  })
  let writeChain = Promise.resolve()
  let settled = false
  let rejectRun: ((error: Error) => void) | null = null
  const abort = () => {
    const error = createDashAbortError()
    downloader.stop()
    rejectRun?.(error)
  }
  const onAborted = () => abort()

  const run = new Promise<void>((resolve, reject) => {
    rejectRun = reject
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    downloader.on('sequentialPush', (buffer) => {
      writeChain = writeChain.then(() => appendFile(outputPath, Buffer.from(buffer)))
    })
    downloader.on('error', message => fail(new Error(message)))
    downloader.on('aborted', () => fail(createDashAbortError()))
    downloader.on('failed', (_failedFragments, errors) => {
      void writeChain.then(() => {
        const failedIndexes = Array.from(errors)
          .map(fragment => Number(fragment.index) + 1)
          .filter(Number.isFinite)
        fail(new Error(
          failedIndexes.length
            ? `DASH 分片下载失败：${failedIndexes.map(index => `#${index}`).join(', ')}`
            : 'DASH 分片下载失败',
        ))
      }).catch(error => fail(error instanceof Error ? error : new Error(String(error))))
    })
    downloader.on('allCompleted', () => {
      void writeChain.then(() => {
        if (settled) return
        settled = true
        resolve()
      }).catch(error => fail(error instanceof Error ? error : new Error(String(error))))
    })
    options.signal.addEventListener('abort', onAborted, { once: true })
    if (options.signal.aborted) {
      abort()
      return
    }
    downloader.start()
  })

  try {
    await run
  } finally {
    options.signal.removeEventListener('abort', onAborted)
    downloader.destroy()
  }
}

/** Append one live DASH representation delta to an existing local track. */
export async function appendDashRepresentationSegments(
  representation: DashRepresentation,
  outputPath: string,
  options: {
    appendInitialization?: boolean
    fetch?: EmbeddedBrowserFragmentFetch
    headers?: Record<string, string>
    maxRetries?: number
    signal: AbortSignal
    threadCount?: number
  },
) {
  const resolvedRepresentation = await expandSegmentBaseRepresentation(representation, options)
  const fragments = createFragments(resolvedRepresentation)
  const selectedFragments = options.appendInitialization === false
    ? fragments.filter((_fragment, index) => index > 0 || !resolvedRepresentation.initializationUrl)
    : fragments
  if (!selectedFragments.length) return { bytesReceived: 0, fragments: 0 }
  throwIfAborted(options.signal)

  const downloader = new EmbeddedBrowserFragmentDownloader({
    fetch: options.fetch,
    fragments: selectedFragments,
    headers: options.headers,
    maxRetries: Math.max(0, Number(options.maxRetries ?? 2)),
    thread: Math.max(1, Number(options.threadCount || 8)),
  })
  let writeChain = Promise.resolve()
  let bytesReceived = 0
  let settled = false
  let rejectRun: ((error: Error) => void) | null = null
  const abort = () => {
    const error = createDashAbortError()
    downloader.stop()
    rejectRun?.(error)
  }
  const onAborted = () => abort()

  const run = new Promise<void>((resolve, reject) => {
    rejectRun = reject
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    downloader.on('sequentialPush', (buffer) => {
      bytesReceived += buffer.byteLength
      writeChain = writeChain.then(() => appendFile(outputPath, Buffer.from(buffer)))
    })
    downloader.on('error', message => fail(new Error(message)))
    downloader.on('aborted', () => fail(createDashAbortError()))
    downloader.on('failed', (_failedFragments, errors) => {
      void writeChain.then(() => {
        const failedIndexes = Array.from(errors)
          .map(fragment => Number(fragment.index) + 1)
          .filter(Number.isFinite)
        fail(new Error(
          failedIndexes.length
            ? `DASH 分片下载失败：${failedIndexes.map(index => `#${index}`).join(', ')}`
            : 'DASH 分片下载失败',
        ))
      }).catch(error => fail(error instanceof Error ? error : new Error(String(error))))
    })
    downloader.on('allCompleted', () => {
      void writeChain.then(() => {
        if (settled) return
        settled = true
        resolve()
      }).catch(error => fail(error instanceof Error ? error : new Error(String(error))))
    })
    options.signal.addEventListener('abort', onAborted, { once: true })
    if (options.signal.aborted) {
      abort()
      return
    }
    downloader.start()
  })

  try {
    await run
    return { bytesReceived, fragments: selectedFragments.length }
  } finally {
    options.signal.removeEventListener('abort', onAborted)
    downloader.destroy()
  }
}

function validateSelectedRepresentation(
  plan: DashTaskPlan,
  representation: DashRepresentation | undefined,
  expectedType: 'audio' | 'video',
) {
  if (!representation) return
  const planRepresentation = plan.representations.find(item => item.id === representation.id)
  if (!planRepresentation) throw new Error(`选择的 DASH ${expectedType} 轨道不属于当前计划`)
  if (planRepresentation.contentType !== expectedType) {
    throw new Error(`选择的 DASH 轨道类型不是 ${expectedType}`)
  }
  if (planRepresentation.unsupportedReasons.length) {
    throw new Error(`DASH ${expectedType} 轨道暂不可下载：${planRepresentation.unsupportedReasons[0]}`)
  }
  if (plan.isDynamic && planRepresentation.segments.length === 0) {
    throw new Error(`动态 DASH ${expectedType} 轨道当前窗口没有可下载分片`)
  }
}

export class DashTaskExecutor {
  private readonly options: DashTaskExecutorOptions

  private abortController: AbortController | null = null

  private disposed = false

  constructor(options: DashTaskExecutorOptions) {
    this.options = options
  }

  cancel() {
    this.abortController?.abort()
  }

  async run(): Promise<DashTaskResult> {
    if (this.disposed) throw new Error('DASH task executor 已释放')
    if (this.abortController) throw new Error('DASH task 已经在执行中')
    const {
      mergeTracks,
      onEvent,
      outputPath,
      plan,
      selectedAudioRepresentation,
      selectedVideoRepresentation,
    } = this.options
    if (!selectedAudioRepresentation && !selectedVideoRepresentation) {
      throw new Error('至少需要选择一条 DASH 轨道')
    }
    if (plan.hasDrm) throw new Error('当前 DASH 检测到 DRM，暂不支持下载')
    if (plan.unsupportedReasons?.length) {
      throw new Error(`当前 DASH 计划暂不可下载：${plan.unsupportedReasons[0]}`)
    }
    validateSelectedRepresentation(plan, selectedVideoRepresentation, 'video')
    validateSelectedRepresentation(plan, selectedAudioRepresentation, 'audio')

    const runController = new AbortController()
    this.abortController = runController
    const forwardAbort = () => runController.abort()
    this.options.signal?.addEventListener('abort', forwardAbort, { once: true })
    let workDirectoryPath = this.options.workDirectoryPath || ''
    const ownsWorkDirectory = !workDirectoryPath
    const outputExisted = await access(outputPath).then(() => true).catch(() => false)
    try {
      onEvent?.({ message: 'DASH 任务正在准备轨道', stage: 'preparing', status: 'running' })
      workDirectoryPath = workDirectoryPath || await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-task-'))
      const trackOptions = {
        fetch: this.options.fetch,
        headers: this.options.headers || plan.headers,
        maxRetries: Math.max(0, Number(this.options.maxRetries ?? 2)),
        signal: runController.signal,
        threadCount: Math.max(1, Number(this.options.threadCount || 8)),
      }
      const videoTrackPath = selectedVideoRepresentation
        ? path.join(workDirectoryPath, 'video-track.bin')
        : undefined
      const audioTrackPath = selectedAudioRepresentation
        ? path.join(workDirectoryPath, 'audio-track.bin')
        : undefined
      const trackPromise = Promise.all([
        selectedVideoRepresentation && videoTrackPath
          ? downloadRepresentation(selectedVideoRepresentation, videoTrackPath, trackOptions)
          : Promise.resolve(),
        selectedAudioRepresentation && audioTrackPath
          ? downloadRepresentation(selectedAudioRepresentation, audioTrackPath, trackOptions)
          : Promise.resolve(),
      ])
      try {
        await trackPromise
      } catch (error) {
        runController.abort()
        await trackPromise.catch(() => undefined)
        throw error
      }

      throwIfAborted(runController.signal)
      onEvent?.({ message: 'DASH 轨道已下载，开始合并输出', stage: 'merging', status: 'running' })
      const result = await mergeTracks({
        audio: audioTrackPath && selectedAudioRepresentation
          ? { path: audioTrackPath, representation: selectedAudioRepresentation }
          : undefined,
        outputPath,
        signal: runController.signal,
        video: videoTrackPath && selectedVideoRepresentation
          ? { path: videoTrackPath, representation: selectedVideoRepresentation }
          : undefined,
      })
      throwIfAborted(runController.signal)
      onEvent?.({ message: 'DASH 输出已完成', stage: 'completed', status: 'success' })
      return {
        ffmpegPath: result.ffmpegPath,
        outputPath: result.outputPath,
        workDirectoryPath,
      }
    } catch (error) {
      onEvent?.({
        message: error instanceof Error ? error.message : String(error),
        stage: 'error',
        status: 'error',
      })
      if (!outputExisted) await rm(outputPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      this.options.signal?.removeEventListener('abort', forwardAbort)
      this.abortController = null
      if (ownsWorkDirectory && workDirectoryPath) {
        await rm(workDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
  }
}

export async function readDashTrackFile(track: DashTaskTrackFile) {
  return readFile(track.path)
}
