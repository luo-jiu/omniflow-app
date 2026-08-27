import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { preprocessFragment } from './pipeline'

const fixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-disguised-fragment-preprocess', import.meta.url))
const fixture = JSON.parse(readFileSync(`${fixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const input = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.input}`, 'utf8')) as Record<string, number[]>
const expected = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.expected}`, 'utf8')) as Record<string, number[]>

describe('Cat Catch HLS fragment preprocessing', () => {
  it('hls.cache-fallback-disguised', () => {
    for (const [name, bytes] of Object.entries(input)) {
      const output = new Uint8Array(preprocessFragment(Uint8Array.from(bytes).buffer))
      expect(Array.from(output), name).toEqual(expected[name])
    }
  })
})
