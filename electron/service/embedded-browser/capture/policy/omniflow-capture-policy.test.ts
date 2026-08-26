import { describe, expect, it } from 'vitest'

import { compileCatCatchRules } from '../../cat-catch-port/network/rules'
import {
  classifyOmniFlowNetworkResource,
  compileOmniFlowCaptureSettings,
} from './omniflow-capture-policy'

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

describe('network.omniflow-settings-adaptation', () => {
  it('compiles user extension, MIME, regex, and domain settings into the target policy', () => {
    const settings = compileOmniFlowCaptureSettings({
      domainBlacklist: ['blocked.example', 'blocked.allowed.example'],
      domainWhitelist: ['allowed.example'],
      extensions: ['asset', 'jpg', 'key'],
      mimeTypes: [],
      regexRules: [{
        enabled: true,
        ext: 'asset',
        flags: 'i',
        pattern: String.raw`(^https://allowed\.example/original)/rewrite$`,
      }],
    })

    expect(settings.allowsResourceUrl({
      url: 'https://media.allowed.example/file.asset',
    })).toBe(true)
    expect(settings.allowsResourceUrl({
      url: 'https://blocked.example/file.asset',
    })).toBe(false)
    expect(settings.allowsResourceUrl({
      url: 'https://blocked.allowed.example/file.asset',
    })).toBe(false)
    expect(settings.allowsResourceUrl({
      url: 'https://unlisted.example/file.asset',
    })).toBe(false)

    expect(classifyOmniFlowNetworkResource({
      mimeType: 'video/mp4',
      stage: 'response',
      url: 'https://allowed.example/movie.mp4',
    }, settings.rules, settings)).toMatchObject({
      decision: 'reject',
      reason: 'extension-disabled-or-size',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'application/octet-stream',
      stage: 'response',
      url: 'https://allowed.example/file.asset',
    }, settings.rules, settings)).toMatchObject({
      decision: 'capture',
      extension: 'asset',
      kind: 'other',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'image/jpeg',
      stage: 'response',
      url: 'https://allowed.example/cover.jpg',
    }, settings.rules, settings)).toMatchObject({
      decision: 'capture',
      kind: 'image',
    })
    expect(classifyOmniFlowNetworkResource({
      mimeType: 'image/png',
      stage: 'response',
      url: 'https://allowed.example/cover',
    }, settings.rules, settings)).toMatchObject({
      decision: 'ignore',
    })
    expect(classifyOmniFlowNetworkResource({
      stage: 'request',
      url: 'https://allowed.example/original/rewrite',
    }, settings.rules, settings)).toMatchObject({
      decision: 'capture',
      extension: 'asset',
      reason: 'regex',
      url: 'https://allowed.example/original',
    })
  })
})
