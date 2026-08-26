import { describe, expect, it } from 'vitest'

import { compileCatCatchRules } from '../../cat-catch-port/network/rules'
import { classifyOmniFlowNetworkResource } from './omniflow-capture-policy'

describe('network.omniflow-policy-boundary', () => {
  it('adds product resource kinds without overriding Cat Catch capture or hard rejection', () => {
    const defaultRules = compileCatCatchRules()

    expect(classifyOmniFlowNetworkResource({
      mimeType: 'video/mp4',
      stage: 'response',
      url: 'https://cdn.example/movie.mp4',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'media',
      reason: 'extension',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'text/vtt',
      stage: 'response',
      url: 'https://cdn.example/captions.vtt',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'subtitle',
      reason: 'omniflow-subtitle',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'application/octet-stream',
      stage: 'response',
      url: 'https://cdn.example/secret.base64key',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'key',
      reason: 'omniflow-key',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'image/avif',
      stage: 'response',
      url: 'https://cdn.example/cover',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'image',
      reason: 'omniflow-image',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'application/pdf',
      stage: 'response',
      url: 'https://cdn.example/document',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'document',
      reason: 'omniflow-document',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'application/octet-stream',
      stage: 'response',
      url: 'https://cdn.example/opaque',
    }, defaultRules)).toMatchObject({
      decision: 'ignore',
      reason: 'no-match',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'video/mp2t',
      stage: 'response',
      url: 'https://cdn.example/segment.ts',
    }, defaultRules)).toMatchObject({
      decision: 'reject',
      reason: 'extension-disabled-or-size',
    })

    const blacklistRules = compileCatCatchRules({
      regex: [{
        blackList: true,
        regex: String.raw`https://blocked\.example/.*`,
        state: true,
        type: 'i',
      }],
    })
    expect(classifyOmniFlowNetworkResource({
      stage: 'request',
      url: 'https://blocked.example/cover.jpg',
    }, blacklistRules)).toMatchObject({
      decision: 'reject',
      reason: 'regex-blacklist',
    })
  })
})
