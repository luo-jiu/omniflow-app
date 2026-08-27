import { describe, expect, it } from 'vitest'

import { selectNewestMatchingHlsTaskProjection } from './hls-task-projection'

describe('HLS task projection recovery', () => {
  it('does not let an older snapshot overwrite a newer live event', () => {
    expect(selectNewestMatchingHlsTaskProjection([
      {
        manifestUrl: 'https://example.com/variant.m3u8',
        mode: 'local-plan',
        requestId: 'request-1',
        revision: 4,
        stage: 'preparing',
        status: 'running',
        tabId: 'tab-1',
      },
    ], {
      afterRevision: 5,
      manifestUrls: ['https://example.com/master.m3u8', 'https://example.com/variant.m3u8'],
      tabId: 'tab-1',
    })).toBeNull()
  })

  it('selects only the newest projection for the current tab and HLS resource', () => {
    expect(selectNewestMatchingHlsTaskProjection([
      {
        manifestUrl: 'https://example.com/variant.m3u8',
        mode: 'local-plan',
        requestId: 'same-request',
        revision: 7,
        stage: 'downloading-fragments',
        status: 'running',
        tabId: 'another-tab',
      },
      {
        manifestUrl: 'https://example.com/unrelated.m3u8',
        mode: 'local-plan',
        requestId: 'unrelated-request',
        revision: 8,
        stage: 'completed',
        status: 'success',
        tabId: 'tab-1',
      },
      {
        manifestUrl: 'https://example.com/master.m3u8',
        mode: 'direct-manifest',
        requestId: 'request-1',
        revision: 6,
        stage: 'preparing',
        status: 'running',
        tabId: 'tab-1',
      },
      {
        manifestUrl: 'https://example.com/variant.m3u8',
        mode: 'local-plan',
        requestId: 'request-1',
        revision: 9,
        stage: 'downloading-fragments',
        status: 'running',
        tabId: 'tab-1',
      },
    ], {
      afterRevision: 0,
      manifestUrls: ['https://example.com/master.m3u8', 'https://example.com/variant.m3u8'],
      tabId: 'tab-1',
    })).toEqual(expect.objectContaining({
      manifestUrl: 'https://example.com/variant.m3u8',
      requestId: 'request-1',
      revision: 9,
    }))
  })

  it('keeps an already bound request isolated from later tasks on the same manifest', () => {
    expect(selectNewestMatchingHlsTaskProjection([
      {
        manifestUrl: 'https://example.com/live.m3u8',
        mode: 'local-plan',
        requestId: 'later-request',
        revision: 12,
        stage: 'downloading-fragments',
        status: 'running',
        tabId: 'tab-1',
      },
      {
        manifestUrl: 'https://example.com/live.m3u8',
        mode: 'local-plan',
        requestId: 'bound-request',
        revision: 11,
        stage: 'completed',
        status: 'success',
        tabId: 'tab-1',
      },
    ], {
      afterRevision: 0,
      manifestUrls: ['https://example.com/live.m3u8'],
      requestId: 'bound-request',
      tabId: 'tab-1',
    })?.requestId).toBe('bound-request')
  })
})
