import { describe, expect, it } from 'vitest'

import {
  classifyResource,
  classifyResourceFingerprint,
} from './classifier'
import {
  CAT_CATCH_DEFAULT_EXTENSION_RULES,
  CAT_CATCH_DEFAULT_REGEX_RULES,
  checkCatCatchExtension,
  checkCatCatchMimeType,
  compileCatCatchRules,
} from './rules'

describe('Cat Catch network classifier', () => {
  it('network.rule-ordering', () => {
    const defaultRules = compileCatCatchRules()
    expect(
      CAT_CATCH_DEFAULT_EXTENSION_RULES
        .filter(rule => ['ts', 'srt', 'vtt'].includes(rule.ext))
        .map(rule => [rule.ext, rule.state]),
    ).toEqual([
      ['ts', false],
      ['srt', false],
      ['vtt', false],
    ])
    expect(CAT_CATCH_DEFAULT_REGEX_RULES[1]).toMatchObject({
      blackList: true,
      state: false,
    })

    const firstPositiveRuleWins = classifyResource({
      stage: 'request',
      url: 'https://api.example/redirect?media=https%3A%2F%2Fcdn.example%2Fvideo.mp4',
    }, compileCatCatchRules({
      regex: [
        {
          ext: 'mp4',
          regex: String.raw`[?&]media=([^&]+)`,
          state: true,
          type: 'i',
        },
        {
          blackList: true,
          regex: String.raw`cdn\.example`,
          state: true,
          type: 'i',
        },
      ],
    }))
    expect(firstPositiveRuleWins).toMatchObject({
      decision: 'capture',
      extension: 'mp4',
      kind: 'media',
      reason: 'regex',
      url: 'https://cdn.example/video.mp4',
    })

    const relativeCapture = classifyResource({
      stage: 'request',
      url: 'https://cdn.example/watch?media=%2Fsegment.m4s',
    }, compileCatCatchRules({
      regex: [{
        regex: String.raw`[?&]media=([^&]+)`,
        state: true,
        type: 'g',
      }],
    }))
    expect(relativeCapture).toMatchObject({
      decision: 'capture',
      reason: 'regex',
      url: 'https://https://cdn.example/watch?media=%2Fsegment.m4s',
    })

    expect(classifyResource({
      stage: 'request',
      url: 'https://api.example/redirect?media=https%3A%2F%2F%5Bbad',
    }, compileCatCatchRules({
      regex: [{
        regex: String.raw`[?&]media=([^&]+)`,
        state: true,
        type: 'g',
      }],
    }))).toMatchObject({
      decision: 'ignore',
      reason: 'invalid-regex-capture',
    })

    expect(classifyResource({
      stage: 'response',
      url: 'https://cdn.example/video%ZZ.mp4',
    }, defaultRules)).toMatchObject({
      decision: 'ignore',
      reason: 'invalid-url',
    })

    expect(classifyResource({
      mimeType: 'video/mp4',
      resourceType: 'media',
      stage: 'request',
      url: 'https://cdn.example/live/segment.m4s',
    }, compileCatCatchRules({
      regex: [{
        blackList: true,
        regex: String.raw`/live/`,
        state: true,
        type: 'i',
      }],
    }))).toMatchObject({
      decision: 'reject',
      reason: 'regex-blacklist',
    })

    expect(classifyResource({
      mimeType: 'video/mp2t',
      resourceType: 'media',
      stage: 'response',
      url: 'https://cdn.example/segment.ts',
    }, defaultRules)).toMatchObject({
      decision: 'reject',
      extension: 'ts',
      reason: 'extension-disabled-or-size',
    })

    expect(classifyResource({
      mimeType: 'video/mp4',
      stage: 'response',
      url: 'https://cdn.example/download.bin',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'media',
      reason: 'mime-type',
    })

    expect(classifyResource({
      contentDisposition: 'attachment; filename="fallback.mp4"',
      mimeType: 'application/octet-stream',
      stage: 'response',
      url: 'https://cdn.example/download',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      extension: 'mp4',
      kind: 'media',
      name: 'fallback.mp4',
      reason: 'content-disposition',
    })

    expect(classifyResource({
      mimeType: 'video/mp4',
      resourceType: 'media',
      stage: 'response',
      url: 'https://cdn.example/no-extension',
    }, compileCatCatchRules({
      mimeTypes: [{ size: 0, state: false, type: 'video/*' }],
    }))).toMatchObject({
      decision: 'reject',
      reason: 'mime-disabled-or-size',
    })

    expect(classifyResource({
      mimeType: 'video/mp4',
      size: 1024,
      stage: 'response',
      url: 'https://cdn.example/video.mp4',
    }, compileCatCatchRules({
      extensions: [{ ext: 'mp4', operator: '>=', size: 10, state: true, unit: 'KB' }],
    }))).toMatchObject({
      decision: 'reject',
      reason: 'extension-disabled-or-size',
    })

    expect(classifyResource({
      contentDisposition: 'attachment; filename="captions.srt"',
      resourceType: 'media',
      stage: 'response',
      url: 'https://cdn.example/download',
    }, defaultRules)).toMatchObject({
      decision: 'reject',
      reason: 'content-disposition-extension-disabled-or-size',
    })

    const wildcardBreaksBeforeExactMime = compileCatCatchRules({
      mimeTypes: [
        { size: 0, state: false, type: 'video/*' },
        { size: 0, state: true, type: 'video/mp4' },
      ],
    })
    expect(checkCatCatchMimeType('video/mp4', 10, wildcardBreaksBeforeExactMime)).toBe('break')
  })

  it('network.mime-extension-dedupe', () => {
    const defaultRules = compileCatCatchRules()
    expect(classifyResource({
      mimeType: 'application/octet-stream',
      stage: 'response',
      url: 'https://cdn.example/video.mp4',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      extension: 'mp4',
      kind: 'media',
      mimeType: 'application/octet-stream',
      reason: 'extension',
    })
    expect(classifyResource({
      mimeType: 'video/mp4; charset=binary',
      stage: 'response',
      url: 'https://cdn.example/video.bin',
    }, defaultRules)).toMatchObject({
      decision: 'capture',
      kind: 'media',
      mimeType: 'video/mp4',
      reason: 'mime-type',
    })
    const hls = classifyResource({
      mimeType: 'application/vnd.apple.mpegurl',
      stage: 'response',
      url: 'https://cdn.example/playback',
    }, defaultRules)
    expect(hls).toMatchObject({
      decision: 'capture',
      kind: 'manifest',
      reason: 'mime-type',
    })

    const initialSizeRule = compileCatCatchRules({
      extensions: [{ ext: 'mp4', size: 10, unit: 'KB', state: true }],
    })
    const changedSizeRule = compileCatCatchRules({
      extensions: [{ ext: 'mp4', size: 10, unit: 'KB', state: true }],
      phase: 'storage-change',
    })
    const rangedSizeRule = compileCatCatchRules({
      extensions: [{
        ext: 'mp4',
        operator: '~',
        size: '2-4',
        state: true,
        unit: 'KB',
      }],
    })
    expect(checkCatCatchExtension('mp4', 12 * 1024, initialSizeRule)).toBe(true)
    expect(checkCatCatchExtension('mp4', 12 * 1024, changedSizeRule)).toBe('break')
    expect(checkCatCatchExtension('mp4', 3 * 1024, rangedSizeRule)).toBe(true)
    expect(checkCatCatchExtension('mp4', 5 * 1024, rangedSizeRule)).toBe('break')

    const tabAFingerprints = new Set<string>()
    const first = classifyResourceFingerprint({
      capturedResourceCount: 0,
      fingerprints: tabAFingerprints,
      url: hls.url,
    })
    expect(first).toEqual({
      decision: 'accept',
      effect: 'record',
      fingerprint: 'https://cdn.example/playback',
    })
    if (first.effect === 'record') tabAFingerprints.add(first.fingerprint)
    expect(classifyResourceFingerprint({
      capturedResourceCount: 1,
      fingerprints: tabAFingerprints,
      url: 'https://cdn.example/playback',
    })).toMatchObject({ decision: 'duplicate' })
    expect(classifyResourceFingerprint({
      capturedResourceCount: 1,
      fingerprints: tabAFingerprints,
      url: 'https://cdn.example/playback?variant=audio',
    })).toMatchObject({
      decision: 'accept',
      fingerprint: 'https://cdn.example/playback?variant=audio',
    })
    expect(classifyResourceFingerprint({
      capturedResourceCount: 0,
      fingerprints: new Set(),
      url: 'https://cdn.example/playback',
    })).toMatchObject({ decision: 'accept' })

    expect(classifyResourceFingerprint({
      capturedResourceCount: 500,
      fingerprints: tabAFingerprints,
      url: 'https://cdn.example/playback',
    })).toMatchObject({
      decision: 'duplicate',
      effect: 'none',
    })

    expect(classifyResourceFingerprint({
      capturedResourceCount: 1,
      checkDuplicates: false,
      fingerprints: tabAFingerprints,
      url: 'https://cdn.example/playback',
    })).toMatchObject({
      decision: 'accept',
      effect: 'none',
    })

    const fingerprintsAtResetBoundary = new Set(
      Array.from({ length: 499 }, (_, index) => `https://cdn.example/${index}`),
    )
    expect(classifyResourceFingerprint({
      capturedResourceCount: 499,
      fingerprints: fingerprintsAtResetBoundary,
      url: 'https://cdn.example/499',
    })).toMatchObject({
      decision: 'accept',
      effect: 'record-then-reset',
    })
    expect(classifyResourceFingerprint({
      capturedResourceCount: 501,
      fingerprints: tabAFingerprints,
      url: 'https://cdn.example/playback',
    })).toMatchObject({
      decision: 'accept',
      effect: 'none',
    })
  })
})
