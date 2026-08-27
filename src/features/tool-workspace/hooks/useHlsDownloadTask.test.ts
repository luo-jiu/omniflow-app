import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmbeddedBrowserHlsTaskProjection } from '@/features/embedded-browser/resources/services/embedded-browser-resource.api'
import type { ToolWorkspaceMediaHlsRequest } from '../types'
import { useHlsDownloadTask } from './useHlsDownloadTask'

const apiMocks = vi.hoisted(() => ({
  discardEmbeddedBrowserHlsRecording: vi.fn(),
  downloadEmbeddedBrowserDirectFile: vi.fn(),
  downloadEmbeddedBrowserHlsManifest: vi.fn(),
  downloadEmbeddedBrowserHlsPlan: vi.fn(),
  downloadEmbeddedBrowserHlsTracks: vi.fn(),
  listEmbeddedBrowserCapturedResources: vi.fn(),
  listEmbeddedBrowserHlsTaskSnapshots: vi.fn(),
  retryEmbeddedBrowserHlsPlanFailed: vi.fn(),
  startEmbeddedBrowserHlsRecording: vi.fn(),
  stopEmbeddedBrowserHlsRecording: vi.fn(),
  subscribeEmbeddedBrowserHlsTask: vi.fn(),
}))

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))
vi.mock('@/features/embedded-browser/resources/services/embedded-browser-resource.api', () => apiMocks)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createLiveHlsRequest(): ToolWorkspaceMediaHlsRequest {
  const manifestUrl = 'https://example.com/live.m3u8'
  return {
    id: 1,
    kind: 'hls-download',
    manifest: {
      baseUrl: 'https://example.com/',
      discontinuityCount: 0,
      durationSeconds: 0,
      hasEndList: false,
      isLive: true,
      isMaster: false,
      keys: [],
      maps: [],
      mediaSequence: 1,
      renditions: [],
      segmentCount: 0,
      segments: [],
      variants: [],
    },
    plan: {
      durationSeconds: 0,
      encryptedSegmentCount: 0,
      fragmentCount: 0,
      fragments: [],
      headers: {},
      isLive: true,
      isMaster: false,
      keys: [],
      manifestUrl,
      maps: [],
      mapTag: '',
      partCount: 0,
      renditions: [],
      segmentCount: 0,
      segments: [],
      suggestedThreadCount: 6,
      variants: [],
    },
    resource: {
      capturedAt: 1,
      id: 'resource-1',
      kind: 'manifest',
      source: 'network',
      tabId: 'tab-1',
      url: manifestUrl,
    },
  }
}

function createStaticHlsRequest(): ToolWorkspaceMediaHlsRequest {
  const request = createLiveHlsRequest()
  return {
    ...request,
    manifest: {
      ...request.manifest,
      hasEndList: true,
      isLive: false,
    },
    plan: {
      ...request.plan,
      isLive: false,
    },
  }
}

function renderHlsHook(
  hlsRequest: ToolWorkspaceMediaHlsRequest,
  overrides: Partial<Parameters<typeof useHlsDownloadTask>[0]> = {},
) {
  let current: ReturnType<typeof useHlsDownloadTask> | null = null

  function Harness() {
    current = useHlsDownloadTask({
      hlsRequest,
      onPersistOutput: async () => undefined,
      ...overrides,
    })
    return null
  }

  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness))
  })
  return {
    get current() {
      if (!current) throw new Error('HLS hook was not rendered')
      return current
    },
    unmount: () => act(() => renderer.unmount()),
  }
}

describe('useHlsDownloadTask task projection recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.discardEmbeddedBrowserHlsRecording.mockResolvedValue({ ok: true })
    apiMocks.listEmbeddedBrowserHlsTaskSnapshots.mockResolvedValue([])
    apiMocks.subscribeEmbeddedBrowserHlsTask.mockReturnValue(() => undefined)
  })

  it('hls.renderer-task-listener-recovery', async () => {
    const firstSnapshot = deferred<EmbeddedBrowserHlsTaskProjection[]>()
    let listener: ((payload: EmbeddedBrowserHlsTaskProjection) => void) | null = null
    apiMocks.subscribeEmbeddedBrowserHlsTask.mockImplementation((nextListener) => {
      listener = nextListener
      return () => {
        if (listener === nextListener) {
          listener = null
        }
      }
    })
    apiMocks.listEmbeddedBrowserHlsTaskSnapshots
      .mockReturnValueOnce(firstSnapshot.promise)
      .mockResolvedValueOnce([{
        completedFragments: 8,
        manifestUrl: 'https://example.com/live.m3u8',
        message: 'recording completed while detached',
        mode: 'local-plan',
        outputPath: '/tmp/live.mp4',
        requestId: 'request-1',
        revision: 6,
        stage: 'completed',
        status: 'success',
        tabId: 'tab-1',
        totalFragments: 8,
      }])

    const firstMount = renderHlsHook(createStaticHlsRequest())
    act(() => {
      listener?.({
        completedFragments: 5,
        manifestUrl: 'https://example.com/live.m3u8',
        message: 'recording',
        mode: 'local-plan',
        requestId: 'request-1',
        revision: 5,
        stage: 'downloading-fragments',
        status: 'running',
        tabId: 'tab-1',
        totalFragments: 8,
      })
    })
    expect(firstMount.current.hlsTaskStatus.stage).toBe('downloading-fragments')
    expect(firstMount.current.hlsLiveRecordingState).toBe('idle')

    await act(async () => {
      firstSnapshot.resolve([{
        manifestUrl: 'https://example.com/live.m3u8',
        message: 'stale preparing snapshot',
        mode: 'local-plan',
        requestId: 'request-1',
        revision: 4,
        stage: 'preparing',
        status: 'running',
        tabId: 'tab-1',
      }])
      await firstSnapshot.promise
    })
    expect(firstMount.current.hlsTaskStatus.stage).toBe('downloading-fragments')

    firstMount.unmount()
    expect(apiMocks.discardEmbeddedBrowserHlsRecording).not.toHaveBeenCalled()

    const secondMount = renderHlsHook(createStaticHlsRequest())
    await act(async () => {
      await Promise.resolve()
    })
    expect(secondMount.current.hlsTaskStatus).toEqual(expect.objectContaining({
      completedFragments: 8,
      lastOutputPath: '/tmp/live.mp4',
      requestId: 'request-1',
      stage: 'completed',
      state: 'success',
    }))
    expect(secondMount.current.hlsLiveRecordingState).toBe('idle')
    secondMount.unmount()
  })

  it('hls.live-unmount-output-cleanup', async () => {
    const cleanupOutputDirectory = vi.fn().mockResolvedValue(undefined)
    const discardResult = deferred<{ ok: boolean }>()
    apiMocks.discardEmbeddedBrowserHlsRecording.mockReturnValue(discardResult.promise)
    apiMocks.startEmbeddedBrowserHlsRecording.mockResolvedValue({ ok: true })
    const mount = renderHlsHook(createLiveHlsRequest(), {
      createOutputTargetSnapshot: async () => ({
        cleanupOutputDirectory,
        outputDirectoryPath: '/tmp/hls-live-output',
        persistOutput: async () => undefined,
      }),
    })

    await act(async () => {
      await mount.current.handlers.onStartLiveRecording()
    })
    const startPayload = apiMocks.startEmbeddedBrowserHlsRecording.mock.calls[0]?.[1]
    expect(startPayload?.requestId).toMatch(/^hls-live-/)
    expect(mount.current.hlsLiveRecordingState).toBe('recording')

    const requestId = startPayload.requestId
    apiMocks.listEmbeddedBrowserHlsTaskSnapshots.mockResolvedValue([{
      manifestUrl: 'https://example.com/live.m3u8',
      mode: 'local-plan',
      requestId,
      revision: 3,
      stage: 'downloading-fragments',
      status: 'running',
      tabId: 'tab-1',
    }])
    mount.unmount()
    const remount = renderHlsHook(createLiveHlsRequest())
    await act(async () => {
      await Promise.resolve()
    })
    expect(remount.current.hlsLiveRecordingState).toBe('idle')
    expect(remount.current.hlsTaskStatus.requestId).toBeUndefined()
    expect(cleanupOutputDirectory).not.toHaveBeenCalled()

    discardResult.resolve({ ok: true })
    await vi.waitFor(() => {
      expect(apiMocks.discardEmbeddedBrowserHlsRecording).toHaveBeenCalledWith('tab-1', {
        requestId,
      })
      expect(cleanupOutputDirectory).toHaveBeenCalledTimes(1)
    })
    remount.unmount()
  })

  it('hls.segment-query-static-plan-integration', async () => {
    const request = createStaticHlsRequest()
    request.plan = {
      ...request.plan,
      fragmentCount: 1,
      fragments: [{
        discontinuitySequence: 0,
        duration: 4,
        index: 0,
        initSegment: {
          url: 'https://example.com/init.mp4?map-auth=keep',
        },
        key: {
          method: 'AES-128',
          url: 'https://example.com/key.bin?key-auth=keep',
        },
        part: false,
        sequence: 1,
        url: 'https://example.com/segment.ts?old=1',
      }],
      keys: [{
        method: 'AES-128',
        url: 'https://example.com/key.bin?key-auth=keep',
      }],
      maps: [{
        url: 'https://example.com/init.mp4?map-auth=keep',
      }],
      segmentCount: 1,
      segments: [{
        discontinuitySequence: 0,
        duration: 4,
        keyUrl: 'https://example.com/key.bin?key-auth=keep',
        mapUrl: 'https://example.com/init.mp4?map-auth=keep',
        part: false,
        sequence: 1,
        url: 'https://example.com/segment.ts?old=1',
      }],
    }
    const persistOutput = vi.fn().mockResolvedValue(undefined)
    apiMocks.downloadEmbeddedBrowserHlsPlan.mockResolvedValue({
      ok: true,
      outputPath: '/tmp/hls-query.mp4',
    })
    const mount = renderHlsHook(request, {
      createOutputTargetSnapshot: async () => ({
        cleanupOutputDirectory: async () => undefined,
        outputDirectoryPath: '/tmp/hls-query-output',
        persistOutput,
      }),
    })

    act(() => {
      mount.current.handlers.onSetHlsSegmentQueryEnabled(true)
      mount.current.handlers.onSetHlsSegmentQueryDraft('token=new&expires=9')
    })
    act(() => {
      mount.current.handlers.onSaveHls()
    })

    await vi.waitFor(() => {
      expect(apiMocks.downloadEmbeddedBrowserHlsPlan).toHaveBeenCalledTimes(1)
    })
    const payload = apiMocks.downloadEmbeddedBrowserHlsPlan.mock.calls[0]?.[1]
    expect(payload.plan.fragments[0]).toMatchObject({
      initSegment: { url: 'https://example.com/init.mp4?map-auth=keep' },
      key: { url: 'https://example.com/key.bin?key-auth=keep' },
      url: 'https://example.com/segment.ts?token=new&expires=9',
    })
    expect(payload.plan.segments[0]).toMatchObject({
      keyUrl: 'https://example.com/key.bin?key-auth=keep',
      mapUrl: 'https://example.com/init.mp4?map-auth=keep',
      url: 'https://example.com/segment.ts?token=new&expires=9',
    })
    expect(apiMocks.downloadEmbeddedBrowserHlsManifest).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(persistOutput).toHaveBeenCalledWith('/tmp/hls-query.mp4'))
    mount.unmount()
  })

  it('hls.segment-query-live-empty-integration', async () => {
    apiMocks.startEmbeddedBrowserHlsRecording.mockResolvedValue({ ok: true })
    const mount = renderHlsHook(createLiveHlsRequest(), {
      createOutputTargetSnapshot: async () => ({
        cleanupOutputDirectory: async () => undefined,
        outputDirectoryPath: '/tmp/hls-live-query-output',
        persistOutput: async () => undefined,
      }),
    })

    act(() => {
      mount.current.handlers.onSetHlsSegmentQueryEnabled(true)
      mount.current.handlers.onSetHlsSegmentQueryDraft('')
    })
    act(() => {
      mount.current.handlers.onStartLiveRecording()
    })

    await vi.waitFor(() => {
      expect(apiMocks.startEmbeddedBrowserHlsRecording).toHaveBeenCalledTimes(1)
    })
    expect(apiMocks.startEmbeddedBrowserHlsRecording.mock.calls[0]?.[1])
      .toEqual(expect.objectContaining({ segmentQuery: '' }))
    mount.unmount()
  })
})
