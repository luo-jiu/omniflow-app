import { describe, expect, it } from 'vitest'

import {
  applyEmbeddedBrowserHlsSegmentQuery,
  createEmbeddedBrowserHlsDownloadPlan,
  parseEmbeddedBrowserHlsManifest,
} from '../../../../src/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import { parseHlsManifest } from '../cat-catch-port/hls/parser'
import { createHlsDownloadPlan } from '../cat-catch-port/hls/plan'
import { applyCatCatchHlsSegmentQueryToPlan } from '../cat-catch-port/hls/segment-query'

describe('shared HLS contract', () => {
  it('hls.contract-plan-single-owner', () => {
    expect(parseEmbeddedBrowserHlsManifest).toBe(parseHlsManifest)
    expect(createEmbeddedBrowserHlsDownloadPlan).toBe(createHlsDownloadPlan)
    expect(applyEmbeddedBrowserHlsSegmentQuery).toBe(applyCatCatchHlsSegmentQueryToPlan)
  })
})
