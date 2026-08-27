import { describe, expect, it, vi } from 'vitest'

import { EmbeddedBrowserHlsSessionOwner } from './hls-session-owner'

type RetrySession = {
  failedFragments: number[]
  requestId: string
  tabId: string
  workDirectoryPath: string
}

type LiveSession = {
  recorder: {
    discard: () => Promise<void>
    getCurrentWorkDirectoryPath: () => string
  }
  requestId: string
  tabId: string
  workDirectoryPath?: string
}

describe('EmbeddedBrowser HLS session owner', () => {
  it('hls.session-owner-tab-cleanup', async () => {
    const removedDirectories: string[] = []
    const firstDiscard = vi.fn(async () => undefined)
    const secondDiscard = vi.fn(async () => undefined)
    const owner = new EmbeddedBrowserHlsSessionOwner<RetrySession, LiveSession>({
      removeWorkDirectory: async (workDirectoryPath) => {
        removedDirectories.push(workDirectoryPath)
      },
    })
    owner.upsertRetry({
      failedFragments: [2],
      requestId: 'retry-1',
      tabId: 'tab-1',
      workDirectoryPath: '/tmp/retry-1',
    })
    owner.upsertLive({
      recorder: {
        discard: firstDiscard,
        getCurrentWorkDirectoryPath: () => '/tmp/live-from-recorder',
      },
      requestId: 'live-1',
      tabId: 'tab-1',
    })
    owner.upsertRetry({
      failedFragments: [3],
      requestId: 'retry-2',
      tabId: 'tab-2',
      workDirectoryPath: '/tmp/retry-2',
    })
    owner.upsertLive({
      recorder: {
        discard: secondDiscard,
        getCurrentWorkDirectoryPath: () => '/tmp/live-2',
      },
      requestId: 'live-2',
      tabId: 'tab-2',
    })

    await Promise.all([
      owner.clearRetry({ tabId: 'tab-1' }),
      owner.clearLive({ tabId: 'tab-1' }),
    ])

    expect(owner.getRetry('retry-1', 'tab-1')).toBeUndefined()
    expect(owner.getLive('live-1', 'tab-1')).toBeUndefined()
    expect(owner.getRetry('retry-2', 'tab-2')?.failedFragments).toEqual([3])
    expect(owner.getLive('live-2', 'tab-2')).toBeDefined()
    expect(firstDiscard).toHaveBeenCalledTimes(1)
    expect(secondDiscard).not.toHaveBeenCalled()
    expect(removedDirectories).toEqual(['/tmp/retry-1', '/tmp/live-from-recorder'])
  })

  it('hls.session-owner-dispose', async () => {
    const removedDirectories: string[] = []
    const owner = new EmbeddedBrowserHlsSessionOwner<RetrySession, LiveSession>({
      removeWorkDirectory: async (workDirectoryPath) => {
        removedDirectories.push(workDirectoryPath)
      },
    })
    const firstDiscard = vi.fn(async () => undefined)
    const secondDiscard = vi.fn(async () => undefined)
    owner.upsertRetry({
      failedFragments: [1],
      requestId: 'retry-a',
      tabId: 'tab-a',
      workDirectoryPath: '/tmp/retry-a',
    })
    owner.upsertLive({
      recorder: {
        discard: firstDiscard,
        getCurrentWorkDirectoryPath: () => '/tmp/live-a',
      },
      requestId: 'live-a',
      tabId: 'tab-a',
    })
    owner.upsertLive({
      recorder: {
        discard: secondDiscard,
        getCurrentWorkDirectoryPath: () => '/tmp/live-b-fallback',
      },
      requestId: 'live-b',
      tabId: 'tab-b',
      workDirectoryPath: '/tmp/live-b',
    })

    await owner.dispose()

    expect(owner.findLiveByTab('tab-a')).toBeUndefined()
    expect(firstDiscard).toHaveBeenCalledTimes(1)
    expect(secondDiscard).toHaveBeenCalledTimes(1)
    expect(removedDirectories).toEqual(expect.arrayContaining([
      '/tmp/retry-a',
      '/tmp/live-a',
      '/tmp/live-b',
    ]))
  })

  it('keeps equal renderer request ids isolated by tab', async () => {
    const removedDirectories: string[] = []
    const owner = new EmbeddedBrowserHlsSessionOwner<RetrySession, LiveSession>({
      removeWorkDirectory: async (workDirectoryPath) => {
        removedDirectories.push(workDirectoryPath)
      },
    })
    owner.upsertRetry({
      failedFragments: [1],
      requestId: 'shared-request',
      tabId: 'tab-a',
      workDirectoryPath: '/tmp/retry-a',
    })
    owner.upsertRetry({
      failedFragments: [2],
      requestId: 'shared-request',
      tabId: 'tab-b',
      workDirectoryPath: '/tmp/retry-b',
    })

    await owner.clearRetry({ requestId: 'shared-request', tabId: 'tab-a' })

    expect(owner.getRetry('shared-request', 'tab-a')).toBeUndefined()
    expect(owner.getRetry('shared-request', 'tab-b')?.failedFragments).toEqual([2])
    expect(removedDirectories).toEqual(['/tmp/retry-a'])
  })

  it('transfers terminal ownership without running cleanup', async () => {
    const removeWorkDirectory = vi.fn(async () => undefined)
    const discard = vi.fn(async () => undefined)
    const owner = new EmbeddedBrowserHlsSessionOwner<RetrySession, LiveSession>({ removeWorkDirectory })
    const retry: RetrySession = {
      failedFragments: [3],
      requestId: 'retry-terminal',
      tabId: 'tab-1',
      workDirectoryPath: '/tmp/retry-terminal',
    }
    const live: LiveSession = {
      recorder: {
        discard,
        getCurrentWorkDirectoryPath: () => '/tmp/live-terminal',
      },
      requestId: 'live-terminal',
      tabId: 'tab-1',
    }
    owner.upsertRetry(retry)
    owner.upsertLive(live)

    expect(owner.takeRetry(retry.requestId, retry.tabId)).toBe(retry)
    expect(owner.takeLive(live.requestId, live.tabId)).toBe(live)
    await owner.dispose()

    expect(discard).not.toHaveBeenCalled()
    expect(removeWorkDirectory).not.toHaveBeenCalled()
  })
})
