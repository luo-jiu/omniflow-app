import { describe, expect, it, vi } from 'vitest'

import { resolveDashManifestAuthority } from './dash-manifest-authority'

describe('DASH manifest authority', () => {
  it('dash.live-manifest-authority', () => {
    const redeem = vi.fn(() => ({
      headers: [['authorization', 'Bearer secret']] as Array<[string, string]>,
      resource: { url: 'https://media.example/live.mpd' },
    }))

    expect(resolveDashManifestAuthority({ redeem }, {
      manifestUrl: 'https://media.example/live.mpd',
      resourceId: 'resource-1',
      tabId: 'tab-1',
    })).toEqual({
      headers: { authorization: 'Bearer secret' },
      manifestUrl: 'https://media.example/live.mpd',
      resourceId: 'resource-1',
    })
    expect(redeem).toHaveBeenCalledWith({
      purpose: 'resource-download',
      resourceId: 'resource-1',
      tabId: 'tab-1',
    })
  })

  it('rejects a renderer URL mismatch instead of producing a browser fallback', () => {
    const redeem = vi.fn(() => ({
      headers: [],
      resource: { url: 'https://media.example/live.mpd' },
    }))

    expect(resolveDashManifestAuthority({ redeem }, {
      manifestUrl: 'https://other.example/live.mpd',
      resourceId: 'resource-1',
      tabId: 'tab-1',
    })).toBeNull()
  })

  it('rejects missing or stale authority inputs', () => {
    const redeem = vi.fn(() => null)
    expect(resolveDashManifestAuthority({ redeem }, {
      manifestUrl: 'https://media.example/live.mpd',
      resourceId: 'resource-1',
      tabId: 'tab-1',
    })).toBeNull()
    expect(resolveDashManifestAuthority({ redeem }, {
      manifestUrl: '   ',
      resourceId: 'resource-1',
      tabId: 'tab-1',
    })).toBeNull()
    expect(redeem).toHaveBeenCalledTimes(1)
  })
})
