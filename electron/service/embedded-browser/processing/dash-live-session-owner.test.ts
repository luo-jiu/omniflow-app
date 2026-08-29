import { describe, expect, it, vi } from 'vitest'

import {
  createEmbeddedBrowserDashHostLifecycle,
  EmbeddedBrowserDashLiveSessionOwner,
} from './dash-live-session-owner'

type LiveSession = {
  recorder: {
    discard: () => Promise<void>
    getCurrentWorkDirectoryPath: () => string
  }
  requestId: string
  tabId: string
  workDirectoryPath?: string
}

describe('EmbeddedBrowser DASH live session owner', () => {
  it('dash.dynamic-session-owner', async () => {
    const removedDirectories: string[] = []
    const discard = vi.fn(async () => undefined)
    const owner = new EmbeddedBrowserDashLiveSessionOwner<LiveSession>({
      removeWorkDirectory: async directory => { removedDirectories.push(directory) },
    })
    const lifecycle = createEmbeddedBrowserDashHostLifecycle(owner)
    owner.upsertLive({
      recorder: {
        discard,
        getCurrentWorkDirectoryPath: () => '/tmp/dash-live-fallback',
      },
      requestId: 'dash-1',
      tabId: 'tab-1',
      workDirectoryPath: '/tmp/dash-live-1',
    })
    owner.recordTaskEvent({
      manifestUrl: 'https://origin.example/live.mpd',
      message: 'running',
      requestId: 'dash-1',
      stage: 'downloading',
      status: 'running',
      tabId: 'tab-1',
    })

    await lifecycle.onTabClosed('tab-1')

    expect(discard).toHaveBeenCalledOnce()
    expect(removedDirectories).toEqual(['/tmp/dash-live-1'])
    expect(owner.getLive('dash-1', 'tab-1')).toBeUndefined()
    expect(owner.listTaskSnapshots({ tabId: 'tab-1' })).toEqual([])
  })

  it('dash.dynamic-session-owner-active-task', async () => {
    const owner = new EmbeddedBrowserDashLiveSessionOwner<LiveSession>()
    let observedSignal: AbortSignal | undefined
    const task = owner.beginActiveTask({ requestId: 'active', tabId: 'tab-1' })
    const settled = new Promise<void>(resolve => {
      observedSignal = task.signal
      task.signal.addEventListener('abort', () => {
        task.complete()
        resolve()
      }, { once: true })
    })

    const clearPromise = owner.clear({ tabId: 'tab-1' })
    await settled
    await clearPromise
    expect(observedSignal?.aborted).toBe(true)
    await owner.dispose()
  })
})
