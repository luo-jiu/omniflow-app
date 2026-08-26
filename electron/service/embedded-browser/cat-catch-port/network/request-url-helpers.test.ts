import { describe, expect, it } from 'vitest'

import {
  compileCatCatchUrlFilterRules,
  evaluateCatCatchPageUrlPolicy,
  isCatCatchForcedBlockedUrl,
  isCatCatchSpecialPageUrl,
  matchesCatCatchUrlFilter,
} from './request-url-helpers'

describe('network.url-filtering-parity', () => {
  it('preserves pinned wildcard and page-policy semantics', () => {
    const rules = compileCatCatchUrlFilterRules([
      { state: false, url: 'https://disabled.example/*' },
      { state: true, url: 'https://*.Example.com/watch/??' },
      { state: true, url: 'https://literal.example/a+b[1]' },
    ])

    expect(matchesCatCatchUrlFilter('https://media.example.com/watch/ab', rules)).toBe(true)
    expect(matchesCatCatchUrlFilter('https://.example.com/watch/ab', rules)).toBe(true)
    expect(matchesCatCatchUrlFilter('https://media/nested.example.com/watch/ab', rules)).toBe(true)
    expect(matchesCatCatchUrlFilter('https://media.example.com/watch/a', rules)).toBe(false)
    expect(matchesCatCatchUrlFilter('https://media.example.com/watch/abc', rules)).toBe(false)
    expect(matchesCatCatchUrlFilter('prefix-https://media.example.com/watch/ab', rules)).toBe(false)
    expect(matchesCatCatchUrlFilter('https://disabled.example/video', rules)).toBe(false)
    expect(matchesCatCatchUrlFilter('https://literal.example/a+b[1]', rules)).toBe(true)

    const globalRule = [{ state: true, url: /example/g }]
    expect(matchesCatCatchUrlFilter('https://example.test/one', globalRule)).toBe(true)
    expect(matchesCatCatchUrlFilter('https://example.test/two', globalRule)).toBe(true)

    expect(isCatCatchForcedBlockedUrl('https://www.douyin.com/video/123')).toBe(true)
    expect(isCatCatchForcedBlockedUrl('https://douyin.com/video/123')).toBe(false)
    expect(isCatCatchForcedBlockedUrl('http://www.douyin.com/video/123')).toBe(false)
    const globalForcedPattern = /douyin/g
    expect(isCatCatchForcedBlockedUrl('https://www.douyin.com/one', [globalForcedPattern])).toBe(true)
    expect(isCatCatchForcedBlockedUrl('https://www.douyin.com/two', [globalForcedPattern])).toBe(true)

    const blockedPageUrl = 'https://blocked.example/watch/one'
    const blockRules = compileCatCatchUrlFilterRules([
      { state: true, url: 'https://blocked.example/*' },
    ])
    expect(evaluateCatCatchPageUrlPolicy({
      rules: [],
      url: 'https://www.douyin.com/video/123',
    })).toEqual({ decision: 'allow', reason: 'allow' })
    expect(evaluateCatCatchPageUrlPolicy({
      rules: [],
      url: 'data:text/plain,hello',
    })).toEqual({ decision: 'block', reason: 'special-page' })
    expect(evaluateCatCatchPageUrlPolicy({
      damn: true,
      blockUrlWhite: true,
      rules: compileCatCatchUrlFilterRules([
        { state: true, url: 'https://www.douyin.com/*' },
      ]),
      url: 'https://www.douyin.com/video/123',
    })).toEqual({ decision: 'block', reason: 'forced-block' })
    expect(evaluateCatCatchPageUrlPolicy({
      rules: blockRules,
      url: blockedPageUrl,
    })).toEqual({ decision: 'block', reason: 'url-filter' })
    expect(evaluateCatCatchPageUrlPolicy({
      blockUrlWhite: true,
      rules: blockRules,
      url: blockedPageUrl,
    })).toEqual({ decision: 'allow', reason: 'allow' })
    expect(evaluateCatCatchPageUrlPolicy({
      blockUrlWhite: true,
      rules: blockRules,
      url: 'https://other.example/watch/one',
    })).toEqual({ decision: 'block', reason: 'url-filter-miss' })
  })
})

describe('network.special-page-parity', () => {
  it('keeps the pinned case-sensitive protocol allowlist', () => {
    expect(isCatCatchSpecialPageUrl('')).toBe(true)
    expect(isCatCatchSpecialPageUrl('null')).toBe(true)
    expect(isCatCatchSpecialPageUrl('chrome-extension://extension/page.html')).toBe(true)
    expect(isCatCatchSpecialPageUrl('data:text/plain,hello')).toBe(true)
    expect(isCatCatchSpecialPageUrl('file:///tmp/media.m3u8')).toBe(true)
    expect(isCatCatchSpecialPageUrl('HTTP://example.com/video')).toBe(true)
    expect(isCatCatchSpecialPageUrl('http://example.com/video')).toBe(false)
    expect(isCatCatchSpecialPageUrl('https://example.com/video')).toBe(false)
    expect(isCatCatchSpecialPageUrl('blob:https://example.com/id')).toBe(false)
  })
})
