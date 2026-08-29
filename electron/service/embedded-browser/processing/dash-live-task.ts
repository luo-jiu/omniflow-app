/**
 * Main-side DASH dynamic snapshot owner.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/mpd.js#showSegment and lib/mpd-parser.min.js#parse
 * Reason: a dynamic MPD must be refreshed without redownloading segments that
 * were already handed to the transfer owner.
 * Adaptation: MPD fetching and XML parsing are injected by the main adapter;
 * this owner only manages lifecycle, polling and deterministic segment deltas.
 * Fixtures: dash.dynamic-refresh-dedupe, dash.dynamic-refresh-cancel.
 */

import type { DashRepresentation, DashSegment } from '../cat-catch-port/dash/parser'
import type { DashTaskPlan } from './dash-task'

export type DashLiveSegmentDelta = {
  plan: DashTaskPlan
  representations: DashRepresentation[]
}

export type DashLiveTaskEvent = {
  completedSegments?: number
  error?: string
  message: string
  stage: 'preparing' | 'refreshing' | 'downloading' | 'stopped' | 'error'
  status: 'running' | 'success' | 'error'
  totalSegments?: number
}

export type DashLiveTaskSnapshotLoader = (input: {
  previousPlan?: DashTaskPlan
  signal: AbortSignal
}) => Promise<DashTaskPlan>

type TimerHandle = ReturnType<typeof setTimeout>

export type DashLiveTaskOptions = {
  loadSnapshot: DashLiveTaskSnapshotLoader
  maxPollIntervalMs?: number
  minPollIntervalMs?: number
  onEvent?: (event: DashLiveTaskEvent) => void
  onNewSegments?: (delta: DashLiveSegmentDelta) => Promise<void> | void
  pollIntervalMs?: number
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  clearSchedule?: (handle: TimerHandle) => void
}

export type DashLiveTaskStopResult = {
  plan: DashTaskPlan
  totalSegments: number
}

function createDashLiveAbortError() {
  const error = new Error('DASH live task aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw createDashLiveAbortError()
}

function createSegmentKey(segment: DashSegment) {
  return [
    segment.number ?? '',
    segment.time ?? '',
    segment.url,
    segment.byteRange?.raw ?? '',
  ].join('|')
}

function cloneRepresentationWithSegments(
  representation: DashRepresentation,
  segments: DashSegment[],
  options: { includeInitialization?: boolean } = {},
): DashRepresentation {
  const nextRepresentation = {
    ...representation,
    segmentCount: segments.length,
    segments,
    unsupportedReasons: [...representation.unsupportedReasons],
  }
  if (options.includeInitialization !== false) return nextRepresentation
  return {
    ...nextRepresentation,
    initializationRange: undefined,
    initializationUrl: undefined,
  }
}

function createSegmentDelta(
  previousPlan: DashTaskPlan | undefined,
  nextPlan: DashTaskPlan,
): DashLiveSegmentDelta {
  const previousRepresentations = new Map(
    (previousPlan?.representations || []).map((representation) => [representation.id, representation]),
  )
  const nextRepresentationIds = new Set(nextPlan.representations.map((representation) => representation.id))
  const nextRepresentations: DashRepresentation[] = []
  const mergedRepresentations = nextPlan.representations.map((representation) => {
    const previous = previousRepresentations.get(representation.id)
    if (previous && (
      previous.initializationUrl !== representation.initializationUrl
      || previous.initializationRange?.raw !== representation.initializationRange?.raw
    )) {
      throw new Error(`DASH Representation ${representation.id} 的动态初始化片段发生变化`)
    }
    const seen = new Set((previous?.segments || []).map(createSegmentKey))
    const newSegments = representation.segments.filter((segment) => {
      const key = createSegmentKey(segment)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (newSegments.length) {
      nextRepresentations.push(cloneRepresentationWithSegments(representation, newSegments, {
        includeInitialization: !previous,
      }))
    }
    return cloneRepresentationWithSegments(
      representation,
      [...(previous?.segments || []), ...newSegments],
    )
  })
  for (const representation of previousPlan?.representations || []) {
    if (!nextRepresentationIds.has(representation.id)) {
      mergedRepresentations.push(cloneRepresentationWithSegments(representation, representation.segments))
    }
  }

  const mergedPlan: DashTaskPlan = {
    ...nextPlan,
    durationSeconds: nextPlan.durationSeconds ?? previousPlan?.durationSeconds,
    representations: mergedRepresentations,
    unsupportedReasons: Array.from(new Set([
      ...(previousPlan?.unsupportedReasons || []),
      ...(nextPlan.unsupportedReasons || []),
    ])),
  }

  return {
    plan: mergedPlan,
    representations: nextRepresentations,
  }
}

function countSegments(plan: DashTaskPlan | undefined) {
  return (plan?.representations || []).reduce((sum, representation) => sum + representation.segments.length, 0)
}

export class DashLiveTask {
  private activePollPromise: Promise<void> | null = null

  private abortController: AbortController | null = null

  private cumulativePlan: DashTaskPlan | undefined

  private disposed = false

  private isRunning = false

  private pollTimer: TimerHandle | null = null

  private readonly clearSchedule: (handle: TimerHandle) => void

  private readonly loadSnapshot: DashLiveTaskSnapshotLoader

  private readonly maxPollIntervalMs: number

  private readonly minPollIntervalMs: number

  private readonly onEvent?: (event: DashLiveTaskEvent) => void

  private readonly onNewSegments?: DashLiveTaskOptions['onNewSegments']

  private readonly pollIntervalMs?: number

  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle

  constructor(options: DashLiveTaskOptions) {
    this.clearSchedule = options.clearSchedule || clearTimeout
    this.loadSnapshot = options.loadSnapshot
    this.maxPollIntervalMs = Math.max(1000, Math.floor(options.maxPollIntervalMs || 10000))
    this.minPollIntervalMs = Math.max(250, Math.min(this.maxPollIntervalMs, Math.floor(options.minPollIntervalMs || 1500)))
    this.onEvent = options.onEvent
    this.onNewSegments = options.onNewSegments
    this.pollIntervalMs = options.pollIntervalMs
    this.schedule = options.schedule || ((callback, delayMs) => setTimeout(callback, delayMs))
  }

  getCurrentPlan() {
    return this.getCurrentPlanSnapshot()
  }

  getCurrentPlanSnapshot() {
    if (!this.cumulativePlan) return undefined
    return {
      ...this.cumulativePlan,
      representations: this.cumulativePlan.representations.map((representation) => ({
        ...representation,
        segments: [...representation.segments],
        unsupportedReasons: [...representation.unsupportedReasons],
      })),
      unsupportedReasons: [...(this.cumulativePlan.unsupportedReasons || [])],
    }
  }

  async start() {
    if (this.disposed) throw new Error('DASH live task 已释放')
    if (this.isRunning) throw new Error('DASH live task 已经在运行中')
    this.abortController = new AbortController()
    this.cumulativePlan = undefined
    this.isRunning = true
    try {
      this.onEvent?.({ message: 'DASH 动态任务正在准备首个 MPD snapshot', stage: 'preparing', status: 'running' })
      await this.refresh()
      if (this.isRunning) this.scheduleNextPoll()
    } catch (error) {
      this.isRunning = false
      this.abortController = null
      if (!(error instanceof Error && error.name === 'AbortError')) {
        this.onEvent?.({
          error: error instanceof Error ? error.message : String(error),
          message: error instanceof Error ? error.message : String(error),
          stage: 'error',
          status: 'error',
        })
      }
      throw error
    }
  }

  async refresh() {
    if (!this.isRunning || !this.abortController) {
      throw new Error('DASH live task 尚未启动')
    }
    if (this.activePollPromise) return this.activePollPromise
    const run = this.pollOnce()
    this.activePollPromise = run
    try {
      await run
    } finally {
      if (this.activePollPromise === run) this.activePollPromise = null
    }
  }

  async stop(): Promise<DashLiveTaskStopResult> {
    await this.settle()
    if (!this.cumulativePlan) throw new Error('DASH 动态任务还没有可用的 MPD snapshot')
    const totalSegments = countSegments(this.cumulativePlan)
    this.onEvent?.({
      completedSegments: totalSegments,
      message: 'DASH 动态任务已停止',
      stage: 'stopped',
      status: 'success',
      totalSegments,
    })
    return { plan: this.getCurrentPlanSnapshot()!, totalSegments }
  }

  async discard() {
    await this.settle()
  }

  dispose() {
    this.disposed = true
    return this.discard()
  }

  private getNextPollDelayMs(plan: DashTaskPlan) {
    const configured = this.pollIntervalMs
      ?? (Number(plan.minimumUpdatePeriodSeconds || 0) * 1000)
      ?? 0
    return Math.max(this.minPollIntervalMs, Math.min(this.maxPollIntervalMs, configured || 4000))
  }

  private scheduleNextPoll() {
    if (!this.isRunning || !this.cumulativePlan) return
    this.pollTimer = this.schedule(() => {
      this.pollTimer = null
      void this.refresh()
        .catch((error) => {
          if (!this.isRunning && error instanceof Error && error.name === 'AbortError') return
          this.isRunning = false
          this.onEvent?.({
            error: error instanceof Error ? error.message : String(error),
            message: error instanceof Error ? error.message : String(error),
            stage: 'error',
            status: 'error',
          })
        })
        .finally(() => {
          if (this.isRunning) this.scheduleNextPoll()
        })
    }, this.getNextPollDelayMs(this.cumulativePlan))
  }

  private async pollOnce() {
    const signal = this.abortController!.signal
    throwIfAborted(signal)
    this.onEvent?.({
      completedSegments: countSegments(this.cumulativePlan),
      message: '正在刷新 DASH MPD snapshot',
      stage: 'refreshing',
      status: 'running',
      totalSegments: countSegments(this.cumulativePlan),
    })
    const nextPlan = await this.loadSnapshot({ previousPlan: this.cumulativePlan, signal })
    throwIfAborted(signal)
    if (!nextPlan.isDynamic) throw new Error('当前 MPD 不是 dynamic manifest，不能启动持续刷新')
    if (nextPlan.hasDrm) throw new Error('当前 DASH 动态任务检测到 DRM，暂不支持持续下载')
    if (nextPlan.unsupportedReasons?.length) {
      throw new Error(`当前 DASH 动态计划暂不可下载：${nextPlan.unsupportedReasons[0]}`)
    }
    const delta = createSegmentDelta(this.cumulativePlan, nextPlan)
    const addedSegments = delta.representations.reduce((sum, representation) => sum + representation.segments.length, 0)
    this.cumulativePlan = delta.plan
    if (delta.representations.length) {
      this.onEvent?.({
        completedSegments: countSegments(this.cumulativePlan),
        message: `DASH snapshot 发现 ${addedSegments} 个新分片`,
        stage: 'downloading',
        status: 'running',
        totalSegments: countSegments(this.cumulativePlan),
      })
      await this.onNewSegments?.(delta)
    }
  }

  private async settle() {
    this.isRunning = false
    if (this.pollTimer) {
      this.clearSchedule(this.pollTimer)
      this.pollTimer = null
    }
    this.abortController?.abort()
    if (this.activePollPromise) {
      await this.activePollPromise.catch(() => undefined)
      this.activePollPromise = null
    }
    this.abortController = null
  }
}

export const __dashLiveTaskInternals = {
  createSegmentDelta,
}
