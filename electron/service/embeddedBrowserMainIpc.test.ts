import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmbeddedBrowserHlsTaskEventPayload } from './embeddedBrowserMainTypes'

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
})
