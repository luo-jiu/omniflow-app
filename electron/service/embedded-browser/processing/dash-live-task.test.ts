import { describe, expect, it, vi } from 'vitest'

import type { DashRepresentation } from '../cat-catch-port/dash/parser'
import { DashLiveTask } from './dash-live-task'
import type { DashTaskPlan } from './dash-task'

function representation(segments: DashRepresentation['segments'], overrides: Partial<DashRepresentation> = {}): DashRepresentation {
  return {
    baseUrls: ['https://cdn.example/'],
    contentType: 'video',
    id: 'video-1',
    segmentCount: segments.length,
    segments,
    unsupportedReasons: [],
    ...overrides,
  }
}

function plan(segments: DashRepresentation['segments'], overrides: Partial<DashTaskPlan> = {}): DashTaskPlan {
  return {
    hasDrm: false,
    isDynamic: true,
    manifestUrl: 'https://cdn.example/live.mpd',
    minimumUpdatePeriodSeconds: 2,
    representations: [representation(segments)],
    ...overrides,
  }
}

describe('DASH live task', () => {
  it('dash.dynamic-refresh-dedupe', async () => {
    const snapshots = [
      plan([
        { duration: 2, index: 0, number: 10, time: 20, url: 'https://cdn.example/10.m4s' },
        { duration: 2, index: 1, number: 11, time: 22, url: 'https://cdn.example/11.m4s' },
      ]),
      plan([
        { duration: 2, index: 0, number: 11, time: 22, url: 'https://cdn.example/11.m4s' },
        { duration: 2, index: 1, number: 12, time: 24, url: 'https://cdn.example/12.m4s' },
      ]),
      plan([
        { duration: 2, index: 0, number: 12, time: 24, url: 'https://cdn.example/12.m4s' },
        { duration: 2, index: 1, number: 13, time: 26, url: 'https://cdn.example/13.m4s' },
      ]),
    ]
    const pendingTimers: Array<() => void> = []
    const deltas: number[][] = []
    const task = new DashLiveTask({
      loadSnapshot: vi.fn(async () => snapshots.shift()!),
      onNewSegments: async (delta) => {
        deltas.push(delta.representations[0]?.segments.map((segment) => segment.number || 0) || [])
      },
      schedule: (callback) => {
        pendingTimers.push(callback)
        return callback as unknown as ReturnType<typeof setTimeout>
      },
      clearSchedule: (handle) => {
        const callback = handle as unknown as () => void
        const index = pendingTimers.indexOf(callback)
        if (index >= 0) pendingTimers.splice(index, 1)
      },
    })

    await task.start()
    expect(deltas).toEqual([[10, 11]])
    expect(pendingTimers).toHaveLength(1)
    pendingTimers.shift()!()
    await vi.waitFor(() => expect(deltas).toEqual([[10, 11], [12]]))
    pendingTimers.shift()!()
    await vi.waitFor(() => expect(deltas).toEqual([[10, 11], [12], [13]]))

    const stopped = await task.stop()
    expect(stopped.totalSegments).toBe(4)
    expect(stopped.plan.representations[0]?.segments.map((segment) => segment.number)).toEqual([10, 11, 12, 13])
    expect(pendingTimers).toHaveLength(0)
  })

  it('does not resend a representation initialization segment on refresh', async () => {
    const initializationUrl = 'https://cdn.example/init.mp4'
    const snapshots = [
      plan([{ index: 0, number: 1, url: 'https://cdn.example/1.m4s' }]),
      plan([{ index: 0, number: 2, url: 'https://cdn.example/2.m4s' }]),
    ]
    const deltas: Array<DashRepresentation> = []
    const callbacks: Array<() => void> = []
    const task = new DashLiveTask({
      loadSnapshot: vi.fn(async () => ({
        ...snapshots.shift()!,
        representations: [
          representation(snapshots.length ? [{ index: 0, number: 1, url: 'https://cdn.example/1.m4s' }] : [{ index: 0, number: 2, url: 'https://cdn.example/2.m4s' }], {
            initializationUrl,
          }),
        ],
      })),
      onNewSegments: (delta) => {
        if (delta.representations[0]) deltas.push(delta.representations[0])
      },
      pollIntervalMs: 1000,
      schedule: (callback) => {
        callbacks.push(callback)
        return callback as unknown as ReturnType<typeof setTimeout>
      },
    })

    await task.start()
    callbacks.shift()?.()
    await vi.waitFor(() => expect(deltas).toHaveLength(2))
    expect(deltas).toHaveLength(2)
    expect(deltas[0]?.initializationUrl).toBe(initializationUrl)
    expect(deltas[1]?.initializationUrl).toBeUndefined()
    await task.discard()
  })

  it('uses minimumUpdatePeriod and rejects static refresh snapshots', async () => {
    const scheduledDelays: number[] = []
    const callbacks: Array<() => void> = []
    const task = new DashLiveTask({
      loadSnapshot: vi.fn(async () => plan([{ index: 0, url: 'https://cdn.example/1.m4s' }])),
      schedule: (callback, delay) => {
        scheduledDelays.push(delay)
        callbacks.push(callback)
        return callback as unknown as ReturnType<typeof setTimeout>
      },
    })

    await task.start()
    expect(scheduledDelays).toEqual([2000])
    callbacks.shift()?.()
    await vi.waitFor(() => expect(task.getCurrentPlan()?.representations[0]?.segments).toHaveLength(1))
    await task.discard()

    const staticTask = new DashLiveTask({
      loadSnapshot: vi.fn(async () => plan([{ index: 0, url: 'https://cdn.example/1.m4s' }], {
        isDynamic: false,
      })),
    })
    await expect(staticTask.start()).rejects.toThrow('不是 dynamic')
  })

  it('dash.dynamic-refresh-terminal-error', async () => {
    const callbacks: Array<() => void> = []
    const onTerminalError = vi.fn()
    const task = new DashLiveTask({
      loadSnapshot: vi.fn()
        .mockResolvedValueOnce(plan([{ index: 0, number: 1, url: 'https://cdn.example/1.m4s' }]))
        .mockRejectedValueOnce(new Error('MPD refresh failed')),
      onTerminalError,
      schedule: (callback) => {
        callbacks.push(callback)
        return callback as unknown as ReturnType<typeof setTimeout>
      },
    })

    await task.start()
    callbacks.shift()?.()
    await vi.waitFor(() => expect(onTerminalError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'MPD refresh failed',
    })))
    expect(task.getCurrentPlan()).toBeDefined()
    await task.discard()
  })

  it('dash.dynamic-refresh-cancel', async () => {
    let resolveSnapshot: (() => void) | undefined
    let observedSignal: AbortSignal | undefined
    const task = new DashLiveTask({
      loadSnapshot: ({ signal }) => new Promise<DashTaskPlan>((resolve, reject) => {
        observedSignal = signal
        resolveSnapshot = () => resolve(plan([{ index: 0, url: 'https://cdn.example/1.m4s' }]))
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }),
    })

    const startPromise = task.start()
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    await task.discard()
    expect(observedSignal?.aborted).toBe(true)
    resolveSnapshot?.()
    await expect(startPromise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
