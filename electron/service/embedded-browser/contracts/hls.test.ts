import { describe, expect, it } from 'vitest'

import { parseHlsManifest } from '../cat-catch-port/hls/parser'
import { createHlsDownloadPlan } from '../cat-catch-port/hls/plan'
import { applyCatCatchHlsSegmentQueryToPlan } from '../cat-catch-port/hls/segment-query'

describe('shared HLS contract', () => {
  it('hls.contract-plan-single-owner', () => {
    const manifestUrl = 'https://media.example/playlist.m3u8?token=old'
    const manifest = parseHlsManifest({
      baseUrl: manifestUrl,
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment.ts?token=old\n#EXT-X-ENDLIST\n',
    })
    const plan = createHlsDownloadPlan({ manifest, manifestUrl })

    expect(applyCatCatchHlsSegmentQueryToPlan(plan, 'token=current'))
      .toMatchObject({
        fragmentCount: 1,
        fragments: [{
          duration: 4,
          sequence: 0,
          url: 'https://media.example/segment.ts?token=current',
        }],
        manifestUrl,
      })
  })
})
