import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  applyCatCatchHlsSegmentQueryToPlan,
  extractCatCatchHlsSegmentQueryDefault,
  rewriteCatCatchHlsFragmentUrl,
} from './segment-query'

const fixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-segment-query-rewrite', import.meta.url))
const input = JSON.parse(readFileSync(`${fixtureRoot}/input.json`, 'utf8'))
const expected = JSON.parse(readFileSync(`${fixtureRoot}/expected.json`, 'utf8'))

describe('Cat Catch HLS segment query compatibility', () => {
  it('hls.segment-query-rewrite', () => {
    expect(input.manifestUrlCases.map((manifestUrl: string) => (
      extractCatCatchHlsSegmentQueryDefault(manifestUrl)
    ))).toEqual(expected.manifestQueryDefaults)

    expect(input.rewriteCases.map((testCase: {
      segmentQuery: string | null
      url: string
    }) => rewriteCatCatchHlsFragmentUrl(testCase.url, testCase.segmentQuery)))
      .toEqual(expected.rewrittenUrls)

    expect(applyCatCatchHlsSegmentQueryToPlan(input.plan, input.segmentQuery))
      .toEqual(expected.plan)
    expect(applyCatCatchHlsSegmentQueryToPlan(input.plan, null)).toBe(input.plan)
  })
})
