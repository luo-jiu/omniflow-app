import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { discoverResources, type DeepSearchDiscovery } from './discovery'

const fixtureRoot = fileURLToPath(new URL(
  '../../../../../tools/cat-catch-lab/fixtures/deep-json-manifest-key-discovery',
  import.meta.url,
))
const fixture = JSON.parse(readFileSync(`${fixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
  pageUrl: string
}
const input = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.input}`, 'utf8')) as {
  lateBase: unknown
  main: unknown
}
const expected = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.expected}`, 'utf8')) as {
  depthWidthCycle: DeepSearchDiscovery[]
  lateBase: DeepSearchDiscovery[]
  main: DeepSearchDiscovery[]
}

describe('Cat Catch deep-search discovery', () => {
  it('deep.inline-manifest-key', () => {
    expect(discoverResources(input.main, { pageUrl: fixture.pageUrl })).toEqual(expected.main)
  })

  it('deep.base-url-blob-signature', () => {
    expect(discoverResources(input.lateBase, { pageUrl: fixture.pageUrl })).toEqual(expected.lateBase)
  })

  it('deep.json-depth-width-cycle', () => {
    const wide = Object.fromEntries(Array.from({ length: 82 }, (_, index) => [
      `item${index}`,
      index === 81 ? 'https://cdn.example/late.mp3' : index,
    ]))
    let allowed: Record<string, unknown> = { url: 'https://cdn.example/depth-allowed.mp4' }
    for (let index = 0; index < 20; index += 1) allowed = { child: allowed }
    let blocked: Record<string, unknown> = { url: 'https://cdn.example/depth-blocked.mp4' }
    for (let index = 0; index < 21; index += 1) blocked = { child: blocked }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    cycle.url = 'https://cdn.example/cycle.flv'

    expect(discoverResources({ allowed, blocked, cycle, wide }, {
      pageUrl: fixture.pageUrl,
    })).toEqual(expected.depthWidthCycle)
  })
})
