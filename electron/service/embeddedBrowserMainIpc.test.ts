import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  EmbeddedBrowserDashTaskEventPayload,
  EmbeddedBrowserHlsTaskEventPayload,
} from './embeddedBrowserMainTypes'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  return {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    handlers,
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle,
  },
}))

import { registerEmbeddedBrowserMainIpcHandlers } from './embeddedBrowserMainIpc'

describe('EmbeddedBrowser main IPC', () => {
  beforeEach(() => {
    electronMock.handle.mockClear()
    electronMock.handlers.clear()
  })

  it('hls.renderer-task-snapshot-ipc', () => {
    const snapshots: EmbeddedBrowserHlsTaskEventPayload[] = [{
      manifestUrl: 'https://example.com/live.m3u8',
      mode: 'local-plan',
      requestId: 'request-1',
      revision: 3,
      stage: 'downloading-fragments',
      status: 'running',
      tabId: 'tab-1',
    }]
    const listHlsTaskSnapshots = vi.fn(() => snapshots)
    const fallbackHandler = vi.fn()
    const handlers = new Proxy({ listHlsTaskSnapshots }, {
      get: (target, property, receiver) => (
        Reflect.has(target, property)
          ? Reflect.get(target, property, receiver)
          : fallbackHandler
      ),
    }) as unknown as Parameters<typeof registerEmbeddedBrowserMainIpcHandlers>[0]
    registerEmbeddedBrowserMainIpcHandlers(handlers)

    const handler = electronMock.handlers.get('embedded-browser:resource:list-hls-task-snapshots')
    expect(handler?.({}, 'tab-1')).toEqual(snapshots)
    expect(listHlsTaskSnapshots).toHaveBeenCalledWith('tab-1')
  })

  it('dash.renderer-task-snapshot-ipc', async () => {
    const snapshots: EmbeddedBrowserDashTaskEventPayload[] = [{
      manifestUrl: 'https://example.com/live.mpd',
      message: 'running',
      requestId: 'request-1',
      revision: 4,
      stage: 'downloading',
      status: 'running',
      tabId: 'tab-1',
    }]
    const listDashTaskSnapshots = vi.fn(() => snapshots)
    const startDashRecording = vi.fn(async () => ({ ok: true, requestId: 'request-1' }))
    const stopDashRecording = vi.fn(async () => ({ ok: true, outputPath: '/tmp/output.mp4' }))
    const discardDashRecording = vi.fn(async () => ({ ok: true }))
    const fallbackHandler = vi.fn()
    const handlers = new Proxy({
      discardDashRecording,
      listDashTaskSnapshots,
      startDashRecording,
      stopDashRecording,
    }, {
      get: (target, property, receiver) => (
        Reflect.has(target, property)
          ? Reflect.get(target, property, receiver)
          : fallbackHandler
      ),
    }) as unknown as Parameters<typeof registerEmbeddedBrowserMainIpcHandlers>[0]
    registerEmbeddedBrowserMainIpcHandlers(handlers)

    await expect(electronMock.handlers.get('embedded-browser:resource:list-dash-task-snapshots')?.({}, 'tab-1'))
      .resolves.toEqual(snapshots)
    await expect(electronMock.handlers.get('embedded-browser:resource:start-dash-recording')?.({}, 'tab-1', { requestId: 'request-1' }))
      .resolves.toEqual({ ok: true, requestId: 'request-1' })
    await expect(electronMock.handlers.get('embedded-browser:resource:stop-dash-recording')?.({}, 'tab-1', { requestId: 'request-1' }))
      .resolves.toEqual({ ok: true, outputPath: '/tmp/output.mp4' })
    await expect(electronMock.handlers.get('embedded-browser:resource:discard-dash-recording')?.({}, 'tab-1', { requestId: 'request-1' }))
      .resolves.toEqual({ ok: true })
    expect(startDashRecording).toHaveBeenCalledWith('tab-1', { requestId: 'request-1' })
    expect(stopDashRecording).toHaveBeenCalledWith('tab-1', { requestId: 'request-1' })
    expect(discardDashRecording).toHaveBeenCalledWith('tab-1', { requestId: 'request-1' })
  })
})
