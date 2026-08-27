import os from 'node:os'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'

import {
  createEmbeddedBrowserHlsDownloadPlan,
  parseEmbeddedBrowserHlsManifest,
  type EmbeddedBrowserHlsDownloadFragment,
  type EmbeddedBrowserHlsDownloadPlan,
  type EmbeddedBrowserHlsManifest,
} from '../../src/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import type { EmbeddedBrowserFragmentFetch } from './embeddedBrowserFragmentDownloader'
import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
} from './embeddedBrowserHlsLocalDownloaderService'

type EmbeddedBrowserHlsLiveRecorderOptions = {
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  manifestUrl: string
  manualKeyBase64?: string
  onEvent?: (event: {
    bytesReceived?: number
    bytesTotal?: number
    completedFragments?: number
    durationSeconds?: number
    error?: string
    etaSeconds?: number
    failedFragments?: number[]
    message: string
    speedBps?: number
    stage: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'completed' | 'error'
    status: 'running' | 'success' | 'error'
    totalFragments?: number
  }) => void
  pageUrl?: string
  suggestedThreadCount?: number
  workDirectoryPath?: string
}

type EmbeddedBrowserHlsLiveRecorderStopResult = {
  durationSeconds: number
  playlistPath: string
  totalFragments: number
  workDirectoryPath: string
}

type EmbeddedBrowserHlsLiveManifestSnapshot = {
  manifest: EmbeddedBrowserHlsManifest
  plan: EmbeddedBrowserHlsDownloadPlan
}

function createLiveFragmentKey(fragment: EmbeddedBrowserHlsDownloadFragment) {
  return `${fragment.sequence}|${fragment.url}`
}

function mergeUniqueByKey<T>(
  existing: T[],
  nextItems: T[],
  createKey: (item: T) => string,
) {
  const seen = new Set(existing.map((item) => createKey(item)))
  const appended: T[] = []
  nextItems.forEach((item) => {
    const key = createKey(item)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    appended.push(item)
  })
  return [...existing, ...appended]
}

async function fetchEmbeddedBrowserHlsLiveManifestSnapshot(input: {
  fetch?: EmbeddedBrowserFragmentFetch
  headers?: Record<string, string>
  manifestUrl: string
  pageUrl?: string
  signal?: AbortSignal
  suggestedThreadCount?: number
}): Promise<EmbeddedBrowserHlsLiveManifestSnapshot> {
  const response = await (input.fetch || ((url, init) => fetch(url, init)))(input.manifestUrl, {
    headers: input.headers,
    signal: input.signal,
  })
  if (!response.ok) {
    throw new Error(`直播 playlist 请求失败：HTTP ${response.status}`)
  }
  const text = await response.text()
  if (!text.includes('#EXTM3U')) {
    throw new Error('当前直播返回内容不像 HLS playlist')
  }
  const manifest = parseEmbeddedBrowserHlsManifest({
    baseUrl: input.manifestUrl,
    text,
  })
  const plan = createEmbeddedBrowserHlsDownloadPlan({
    headers: input.headers || {},
    manifest,
    manifestUrl: input.manifestUrl,
    pageUrl: input.pageUrl,
  })
  if (plan.isMaster) {
    throw new Error('直播录制当前只支持具体 media playlist，不直接录制 master playlist')
  }
  if (!plan.isLive) {
    throw new Error('当前 playlist 不是直播流')
  }
  return {
    manifest,
    plan: input.suggestedThreadCount && input.suggestedThreadCount > 0
      ? {
          ...plan,
          suggestedThreadCount: input.suggestedThreadCount,
        }
      : plan,
  }
}

export class EmbeddedBrowserHlsLiveRecorder {
  private activePollPromise: Promise<void> | null = null

  private abortController: AbortController | null = null

  private cumulativePlan: EmbeddedBrowserHlsDownloadPlan | null = null

  private downloadedBytes = 0

  private isRecording = false

  private manualKeyBase64?: string

  private readonly manifestUrl: string

  private readonly headers?: Record<string, string>

  private readonly fetch?: EmbeddedBrowserFragmentFetch

  private readonly onEvent?: EmbeddedBrowserHlsLiveRecorderOptions['onEvent']

  private readonly pageUrl?: string

  private playlistPath = ''

  private pollIntervalMs = 4000

  private pollTimer: NodeJS.Timeout | null = null

  private readonly suggestedThreadCount?: number

  private workDirectoryPath = ''

  constructor(options: EmbeddedBrowserHlsLiveRecorderOptions) {
    this.headers = options.headers
    this.fetch = options.fetch
    this.manifestUrl = options.manifestUrl
    this.manualKeyBase64 = options.manualKeyBase64
    this.onEvent = options.onEvent
    this.pageUrl = options.pageUrl
    this.suggestedThreadCount = options.suggestedThreadCount
    this.workDirectoryPath = options.workDirectoryPath || ''
  }

  getCurrentWorkDirectoryPath() {
    return this.workDirectoryPath
  }

  async start() {
    if (this.isRecording) {
      throw new Error('直播录制已经在进行中')
    }
    this.abortController = new AbortController()
    this.isRecording = true
    try {
      this.workDirectoryPath = this.workDirectoryPath || await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-'))
      const initialPollPromise = this.pollOnce(true)
      this.activePollPromise = initialPollPromise
      await initialPollPromise
      if (this.isRecording) {
        this.scheduleNextPoll()
      }
    } catch (error) {
      this.isRecording = false
      this.abortController = null
      throw error
    } finally {
      this.activePollPromise = null
    }
  }

  async stop(): Promise<EmbeddedBrowserHlsLiveRecorderStopResult> {
    await this.settleActiveRecording()
    if (!this.cumulativePlan || !this.playlistPath) {
      throw new Error('直播录制还没有可用的本地 playlist')
    }
    return {
      durationSeconds: this.cumulativePlan.durationSeconds,
      playlistPath: this.playlistPath,
      totalFragments: this.cumulativePlan.fragmentCount,
      workDirectoryPath: this.workDirectoryPath,
    }
  }

  async discard() {
    await this.settleActiveRecording()
  }

  private async settleActiveRecording() {
    this.isRecording = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.abortController?.abort()
    if (this.activePollPromise) {
      await this.activePollPromise.catch(() => undefined)
      this.activePollPromise = null
    }
    this.abortController = null
  }

  private scheduleNextPoll() {
    if (!this.isRecording) {
      return
    }
    this.pollTimer = setTimeout(() => {
      this.activePollPromise = this.pollOnce(false)
        .catch((error) => {
          if (!this.isRecording && error instanceof Error && error.name === 'AbortError') {
            return
          }
          this.onEvent?.({
            completedFragments: this.cumulativePlan?.fragmentCount || 0,
            durationSeconds: this.cumulativePlan?.durationSeconds,
            error: error instanceof Error ? error.message : String(error),
            message: error instanceof Error ? error.message : String(error),
            stage: 'error',
            status: 'error',
            totalFragments: this.cumulativePlan?.fragmentCount || 0,
          })
          this.isRecording = false
        })
        .finally(() => {
          this.activePollPromise = null
          if (this.isRecording) {
            this.scheduleNextPoll()
          }
        })
    }, this.pollIntervalMs)
  }

  private async pollOnce(isInitial: boolean) {
    const snapshot = await fetchEmbeddedBrowserHlsLiveManifestSnapshot({
      fetch: this.fetch,
      headers: this.headers,
      manifestUrl: this.manifestUrl,
      pageUrl: this.pageUrl,
      signal: this.abortController?.signal,
      suggestedThreadCount: this.suggestedThreadCount,
    })
    this.pollIntervalMs = Math.max(1500, Math.min(10000, (snapshot.manifest.targetDuration || 4) * 1000))

    if (!this.cumulativePlan) {
      this.cumulativePlan = {
        ...snapshot.plan,
        fragments: snapshot.plan.fragments.map((fragment, index) => ({
          ...fragment,
          index,
        })),
      }
      await this.downloadFragments({
        fragmentIndexes: undefined,
        message: '开始录制直播流',
      })
      return
    }

    const existingFragmentKeys = new Set(this.cumulativePlan.fragments.map((fragment) => createLiveFragmentKey(fragment)))
    const newFragments = snapshot.plan.fragments.filter((fragment) => !existingFragmentKeys.has(createLiveFragmentKey(fragment)))
    if (!newFragments.length) {
      this.onEvent?.({
        completedFragments: this.cumulativePlan.fragmentCount,
        durationSeconds: this.cumulativePlan.durationSeconds,
        message: isInitial ? '开始录制直播流' : '等待直播流产生新分片',
        stage: 'downloading-fragments',
        status: 'running',
        totalFragments: this.cumulativePlan.fragmentCount,
      })
      return
    }

    const nextStartIndex = this.cumulativePlan.fragments.length
    const normalizedNewFragments = newFragments.map((fragment, index) => ({
      ...fragment,
      index: nextStartIndex + index,
    }))
    this.cumulativePlan = {
      ...this.cumulativePlan,
      durationSeconds: this.cumulativePlan.durationSeconds + newFragments.reduce((sum, fragment) => sum + Number(fragment.duration || 0), 0),
      encryptedSegmentCount: this.cumulativePlan.encryptedSegmentCount + newFragments.filter((fragment) => Boolean(fragment.key?.url || fragment.key?.method)).length,
      fragmentCount: this.cumulativePlan.fragmentCount + normalizedNewFragments.length,
      fragments: [...this.cumulativePlan.fragments, ...normalizedNewFragments],
      keys: mergeUniqueByKey(
        this.cumulativePlan.keys,
        snapshot.plan.keys,
        (key) => `${key.method}|${key.url || ''}|${key.iv || ''}`,
      ),
      maps: mergeUniqueByKey(
        this.cumulativePlan.maps,
        snapshot.plan.maps,
        (map) => `${map.url}|${map.byteRange?.raw || ''}`,
      ),
      partCount: this.cumulativePlan.partCount + newFragments.filter((fragment) => fragment.part).length,
      segmentCount: this.cumulativePlan.segmentCount + newFragments.length,
      segments: [
        ...this.cumulativePlan.segments,
        ...newFragments.map((fragment) => ({
          byteRange: fragment.byteRange,
          discontinuitySequence: fragment.discontinuitySequence,
          duration: fragment.duration,
          keyUrl: fragment.key?.url,
          mapUrl: fragment.initSegment?.url,
          part: fragment.part,
          sequence: fragment.sequence,
          url: fragment.url,
        })),
      ],
      suggestedThreadCount: snapshot.plan.suggestedThreadCount,
    }

    await this.downloadFragments({
      fragmentIndexes: normalizedNewFragments.map((fragment) => Number(fragment.index || 0)),
      message: `检测到 ${normalizedNewFragments.length} 个新分片`,
    })
  }

  private async downloadFragments(input: {
    fragmentIndexes?: number[]
    message: string
  }) {
    if (!this.cumulativePlan) {
      throw new Error('直播录制计划还没有初始化')
    }
    const bytesOffset = this.downloadedBytes
    let lastBatchBytes = 0
    const localDownloadResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
      fetch: this.fetch,
      fragmentIndexes: input.fragmentIndexes,
      manualKeyBase64: this.manualKeyBase64,
      preprocessFragments: true,
      onEvent: (event) => {
        const nextBytesReceived = typeof event.bytesReceived === 'number'
          ? bytesOffset + event.bytesReceived
          : bytesOffset
        if (typeof event.bytesReceived === 'number') {
          lastBatchBytes = event.bytesReceived
        }
        this.onEvent?.({
          bytesReceived: nextBytesReceived,
          bytesTotal: undefined,
          completedFragments: event.completedFragments ?? this.cumulativePlan?.fragmentCount,
          durationSeconds: this.cumulativePlan?.durationSeconds,
          error: event.error,
          etaSeconds: undefined,
          failedFragments: event.failedFragments,
          message: event.message || input.message,
          speedBps: event.speedBps,
          stage: event.stage,
          status: event.status,
          totalFragments: this.cumulativePlan?.fragmentCount,
        })
      },
      plan: {
        fragments: this.cumulativePlan.fragments,
        headers: this.cumulativePlan.headers,
        manifestUrl: this.cumulativePlan.manifestUrl,
        suggestedThreadCount: this.cumulativePlan.suggestedThreadCount,
      },
      signal: this.abortController?.signal,
      workDirectoryPath: this.workDirectoryPath,
    })
    this.playlistPath = localDownloadResult.playlistPath
    this.workDirectoryPath = localDownloadResult.workDirectoryPath
    this.downloadedBytes = bytesOffset + lastBatchBytes
    this.onEvent?.({
      bytesReceived: this.downloadedBytes,
      completedFragments: this.cumulativePlan.fragmentCount,
      durationSeconds: this.cumulativePlan.durationSeconds,
      message: input.message,
      stage: 'downloading-fragments',
      status: 'running',
      totalFragments: this.cumulativePlan.fragmentCount,
    })
  }
}
