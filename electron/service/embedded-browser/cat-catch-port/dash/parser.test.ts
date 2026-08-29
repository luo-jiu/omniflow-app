import { describe, expect, it } from 'vitest'

import {
  parseDashByteRange,
  parseDashManifest,
  type DashXmlElement,
} from './parser'

function node(
  name: string,
  attributes: Record<string, string> = {},
  children: DashXmlElement[] = [],
  textContent?: string,
): DashXmlElement {
  return { attributes, children, name, textContent }
}

describe('DASH parser', () => {
  it('dash.parser-core', () => {
    const root = node('MPD', { mediaPresentationDuration: 'PT10S' }, [
      node('BaseURL', {}, [], 'https://cdn.example/root/'),
      node('Period', {}, [
        node('AdaptationSet', {
          contentType: 'video',
          mimeType: 'video/mp4',
        }, [
          node('SegmentTemplate', {
            duration: '2',
            initialization: 'init-$RepresentationID$.mp4',
            media: 'seg-$Number%03d$.m4s',
            startNumber: '7',
          }),
          node('Representation', {
            bandwidth: '1200000',
            codecs: 'avc1.64001f',
            height: '720',
            id: 'video-720',
            width: '1280',
          }),
        ]),
      ]),
    ])

    const manifest = parseDashManifest({
      baseUrl: 'https://origin.example/manifest.mpd',
      root,
      text: '',
    })
    const representation = manifest.representations[0]
    expect(manifest).toMatchObject({
      baseUrls: ['https://cdn.example/root/'],
      durationSeconds: 10,
      hasDrm: false,
      isDynamic: false,
    })
    expect(representation).toMatchObject({
      bandwidth: 1200000,
      contentType: 'video',
      id: 'video-720',
      initializationUrl: 'https://cdn.example/root/init-video-720.mp4',
      segmentCount: 5,
    })
    expect(representation.segments.map(segment => segment.url)).toEqual([
      'https://cdn.example/root/seg-007.m4s',
      'https://cdn.example/root/seg-008.m4s',
      'https://cdn.example/root/seg-009.m4s',
      'https://cdn.example/root/seg-010.m4s',
      'https://cdn.example/root/seg-011.m4s',
    ])
  })

  it('dash.segment-template-final-duration', () => {
    const root = node('MPD', { mediaPresentationDuration: 'PT10S' }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('SegmentTemplate', { duration: '3', media: 'segment-$Number$.m4s' }),
        node('Representation', { id: 'three-second-segments' }),
      ])]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root,
      text: '',
    })
    expect(manifest.representations[0].segments.map(segment => segment.duration)).toEqual([
      3, 3, 3, 1,
    ])

    const listRoot = node('MPD', { mediaPresentationDuration: 'PT10S' }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'three-second-list' }, [
          node('SegmentList', { duration: '3' }, [
            node('SegmentURL', { media: 'list-1.m4s' }),
            node('SegmentURL', { media: 'list-2.m4s' }),
            node('SegmentURL', { media: 'list-3.m4s' }),
            node('SegmentURL', { media: 'list-4.m4s' }),
            node('SegmentURL', { media: 'extra.m4s' }),
          ]),
        ]),
      ])]),
    ])
    const listManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: listRoot,
      text: '',
    })
    expect(listManifest.representations[0].segments.map(segment => segment.duration)).toEqual([
      3, 3, 3, 1,
    ])
    expect(listManifest.representations[0].segments.map(segment => segment.url)).not.toContain(
      'https://cdn.example/media/extra.m4s',
    )
  })

  it('dash.period-template-inheritance', () => {
    const root = node('MPD', {}, [
      node('Period', { duration: 'PT5S' }, [
        node('SegmentTemplate', {
          duration: '2',
          initialization: 'period-init.mp4',
          media: 'period-$Number$.m4s',
          startNumber: '4',
        }),
        node('AdaptationSet', { contentType: 'video' }, [
          node('Representation', { id: 'period-template-video' }),
        ]),
      ]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root,
      text: '',
    })
    expect(manifest.representations[0]).toMatchObject({
      initializationUrl: 'https://cdn.example/media/period-init.mp4',
      segmentCount: 3,
    })
    expect(manifest.representations[0].segments.map(segment => segment.url)).toEqual([
      'https://cdn.example/media/period-4.m4s',
      'https://cdn.example/media/period-5.m4s',
      'https://cdn.example/media/period-6.m4s',
    ])
    expect(manifest.representations[0].segments.map(segment => segment.duration)).toEqual([
      2, 2, 1,
    ])
  })

  it('dash.period-segment-info-inheritance', () => {
    const listRoot = node('MPD', {}, [
      node('Period', { duration: 'PT5S' }, [
        node('SegmentList', { duration: '2' }, [
          node('SegmentURL', { media: 'period-list-1.m4s' }),
          node('SegmentURL', { media: 'period-list-2.m4s' }),
          node('SegmentURL', { media: 'period-list-3.m4s' }),
        ]),
        node('AdaptationSet', { contentType: 'video' }, [
          node('Representation', { id: 'period-list-video' }),
        ]),
      ]),
    ])
    const listManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: listRoot,
      text: '',
    })
    expect(listManifest.representations[0].segments.map(segment => segment.url)).toEqual([
      'https://cdn.example/media/period-list-1.m4s',
      'https://cdn.example/media/period-list-2.m4s',
      'https://cdn.example/media/period-list-3.m4s',
    ])
    expect(listManifest.representations[0].segments.map(segment => segment.duration)).toEqual([
      2, 2, 1,
    ])

    const baseRoot = node('MPD', {}, [
      node('Period', {}, [
        node('SegmentBase'),
        node('AdaptationSet', { contentType: 'video' }, [
          node('Representation', { id: 'period-base-video' }),
        ]),
      ]),
    ])
    const baseManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/period-base.mp4',
      root: baseRoot,
      text: '',
    })
    expect(baseManifest.representations[0].segments).toEqual([{
      index: 0,
      url: 'https://cdn.example/media/period-base.mp4',
    }])
  })

  it('dash.base-url-timeline-ranges', () => {
    const root = node('MPD', { type: 'dynamic' }, [
      node('BaseURL', {}, [], 'https://cdn-a.example/media/'),
      node('BaseURL', {}, [], 'https://cdn-b.example/media/'),
      node('Period', { duration: 'PT14S' }, [
        node('AdaptationSet', { contentType: 'video' }, [
          node('Representation', { id: 'timeline', mimeType: 'video/mp4' }, [
            node('BaseURL', {}, [], 'video/'),
            node('SegmentTemplate', {
              initialization: 'init.mp4',
              media: 'chunk-$Time$.m4s',
              timescale: '1',
            }, [
              node('SegmentTimeline', {}, [
                node('S', { d: '2', r: '-1', t: '0' }),
                node('S', { d: '2', t: '10' }),
              ]),
            ]),
          ]),
        ]),
        node('AdaptationSet', { contentType: 'audio' }, [
          node('Representation', { id: 'audio', mimeType: 'audio/mp4' }, [
            node('SegmentList', { duration: '4', timescale: '2' }, [
              node('Initialization', { range: '0-99', sourceURL: 'audio/init.mp4' }),
              node('SegmentURL', { media: 'audio/one.m4s', mediaRange: '100-199' }),
              node('SegmentURL', { media: 'audio/two.m4s', mediaRange: '200-299' }),
            ]),
          ]),
        ]),
      ]),
    ])

    const manifest = parseDashManifest({ baseUrl: 'https://origin.example/root.mpd', root, text: '' })
    const timeline = manifest.representations[0]
    const audio = manifest.representations[1]
    expect(manifest.isDynamic).toBe(true)
    expect(timeline.baseUrls).toEqual([
      'https://cdn-a.example/media/video/',
      'https://cdn-b.example/media/video/',
    ])
    expect(timeline.segments.map(segment => segment.time)).toEqual([0, 2, 4, 6, 8, 10])
    expect(audio.initializationRange).toEqual({ length: 100, offset: 0, raw: '0-99' })
    expect(audio.segments.map(segment => segment.byteRange)).toEqual([
      { length: 100, offset: 100, raw: '100-199' },
      { length: 100, offset: 200, raw: '200-299' },
    ])
    expect(parseDashByteRange('300-299')).toBeUndefined()
  })

  it('records unbounded negative repeats and DRM evidence', () => {
    const root = node('MPD', { type: 'dynamic' }, [
      node('Period', {}, [
        node('AdaptationSet', { mimeType: 'video/mp4' }, [
          node('ContentProtection', {
            schemeIdUri: 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
          }, [node('cenc:pssh', {}, [], 'AQID')]),
          node('SegmentTemplate', { media: 'segment-$Number$.m4s' }, [
            node('SegmentTimeline', {}, [node('S', { d: '2', r: '-1' })]),
          ]),
          node('Representation', { id: 'drm-video' }),
        ]),
      ]),
    ])
    const manifest = parseDashManifest({ baseUrl: 'https://cdn.example/', root, text: '' })
    expect(manifest.hasDrm).toBe(true)
    expect(manifest.protections[0]).toMatchObject({
      encryptionType: 'Widevine',
      pssh: 'AQID',
    })
    expect(manifest.unsupportedReasons).toContain('segment-timeline-negative-repeat-unbounded')
    expect(manifest.representations[0].segments).toEqual([])
  })

  it('dash.dynamic-negative-repeat-availability', () => {
    const nowMs = Date.parse('2026-08-29T12:00:10Z')
    const root = node('MPD', {
      availabilityStartTime: '2026-08-29T12:00:00Z',
      minimumUpdatePeriod: 'PT2S',
      type: 'dynamic',
    }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'live-video' }, [
          node('SegmentTemplate', { duration: '2', media: 'segment-$Number$.m4s' }, [
            node('SegmentTimeline', {}, [node('S', { d: '2', r: '-1' })]),
          ]),
        ]),
      ])]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      nowMs,
      root,
      text: '',
    })
    expect(manifest.unsupportedReasons).toEqual([])
    expect(manifest.representations[0].segments.map(segment => segment.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(manifest.representations[0].segments.map(segment => segment.url)).toEqual([
      'https://cdn.example/live/segment-1.m4s',
      'https://cdn.example/live/segment-2.m4s',
      'https://cdn.example/live/segment-3.m4s',
      'https://cdn.example/live/segment-4.m4s',
      'https://cdn.example/live/segment-5.m4s',
      'https://cdn.example/live/segment-6.m4s',
    ])
    const notYetAvailable = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      nowMs: Date.parse('2026-08-29T11:59:57Z'),
      root,
      text: '',
    })
    expect(notYetAvailable.representations[0].segments).toEqual([])
  })

  it('dash.dynamic-duration-availability', () => {
    const root = node('MPD', {
      availabilityStartTime: '2026-08-29T12:00:00Z',
      minimumUpdatePeriod: 'PT2S',
      timeShiftBufferDepth: 'PT4S',
      type: 'dynamic',
    }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('SegmentTemplate', {
          duration: '2',
          media: 'segment-$Number$.m4s',
          startNumber: '1',
          timescale: '1',
        }),
        node('Representation', { id: 'duration-live' }),
      ])]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      nowMs: Date.parse('2026-08-29T12:00:10Z'),
      root,
      text: '',
    })
    expect(manifest.unsupportedReasons).toEqual([])
    expect(manifest.representations[0].segments).toEqual([
      {
        duration: 2,
        index: 0,
        number: 4,
        time: 6,
        url: 'https://cdn.example/live/segment-4.m4s',
      },
      {
        duration: 2,
        index: 1,
        number: 5,
        time: 8,
        url: 'https://cdn.example/live/segment-5.m4s',
      },
    ])
  })

  it('dash.dynamic-client-offset', () => {
    const root = node('MPD', {
      availabilityStartTime: '2026-08-29T12:00:00Z',
      minimumUpdatePeriod: 'PT2S',
      type: 'dynamic',
    }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('SegmentTemplate', {
          duration: '2',
          media: 'segment-$Number$.m4s',
        }, [
          node('SegmentTimeline', {}, [node('S', { d: '2', r: '-1' })]),
        ]),
        node('Representation', { id: 'offset-live' }),
      ])]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      clientOffsetMs: 4000,
      nowMs: Date.parse('2026-08-29T12:00:06Z'),
      root,
      text: '',
    })
    expect(manifest.representations[0].segments.map(segment => segment.number)).toEqual([1, 2, 3, 4, 5, 6])

    const durationRoot = node('MPD', {
      availabilityStartTime: '2026-08-29T12:00:00Z',
      minimumUpdatePeriod: 'PT2S',
      timeShiftBufferDepth: 'PT4S',
      type: 'dynamic',
    }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('SegmentTemplate', {
          duration: '2',
          media: 'duration-$Number$.m4s',
        }),
        node('Representation', { id: 'offset-duration-live' }),
      ])]),
    ])
    const durationManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      clientOffsetMs: 4000,
      nowMs: Date.parse('2026-08-29T12:00:06Z'),
      root: durationRoot,
      text: '',
    })
    expect(durationManifest.representations[0].segments.map(segment => segment.number)).toEqual([4, 5])
  })

  it('dash.segment-template-end-number', () => {
    const staticRoot = node('MPD', { mediaPresentationDuration: 'PT10S' }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('SegmentTemplate', {
          duration: '3',
          endNumber: '2',
          media: 'static-$Number$.m4s',
        }),
        node('Representation', { id: 'static-end-number' }),
      ])]),
    ])
    const staticManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      root: staticRoot,
      text: '',
    })
    expect(staticManifest.representations[0].segments.map(segment => segment.number)).toEqual([1, 2])

    const boundedWithoutDurationManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      root: node('MPD', {}, [
        node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
          node('SegmentTemplate', {
            duration: '3',
            endNumber: '2',
            media: 'bounded-$Number$.m4s',
          }),
          node('Representation', { id: 'bounded-without-duration' }),
        ])]),
      ]),
      text: '',
    })
    expect(boundedWithoutDurationManifest.representations[0].segments.map(segment => segment.duration))
      .toEqual([3, 3])

    const dynamicRoot = node('MPD', {
      availabilityStartTime: '2026-08-29T12:00:00Z',
      minimumUpdatePeriod: 'PT2S',
      type: 'dynamic',
    }, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('SegmentTemplate', {
          duration: '2',
          endNumber: '4',
          media: 'dynamic-$Number$.m4s',
          startNumber: '1',
        }),
        node('Representation', { id: 'dynamic-end-number' }),
      ])]),
    ])
    const dynamicManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      nowMs: Date.parse('2026-08-29T12:00:10Z'),
      root: dynamicRoot,
      text: '',
    })
    expect(dynamicManifest.representations[0].segments.map(segment => segment.number)).toEqual([1, 2, 3, 4])

    const emptyManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/live/manifest.mpd',
      root: node('MPD', { mediaPresentationDuration: 'PT10S' }, [
        node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
          node('SegmentTemplate', {
            duration: '2',
            endNumber: '-1',
            media: 'empty-$Number$.m4s',
          }),
          node('Representation', { id: 'empty-end-number' }),
        ])]),
      ]),
      text: '',
    })
    expect(emptyManifest.representations[0].segments).toEqual([])
  })

  it('dash.segment-base-and-period-boundary', () => {
    const singleFileRoot = node('MPD', {}, [
      node('Period', {}, [
        node('AdaptationSet', { contentType: 'video', mimeType: 'video/mp4' }, [
          node('Representation', { id: 'single-file' }, [
            node('BaseURL', {}, [], 'video.mp4'),
            node('SegmentBase'),
          ]),
        ]),
      ]),
    ])
    const singleFileManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: singleFileRoot,
      text: '',
    })
    expect(singleFileManifest.representations[0].segments).toEqual([{
      index: 0,
      url: 'https://cdn.example/media/video.mp4',
    }])
    expect(singleFileManifest.unsupportedReasons).toEqual([])

    const sidxRoot = node('MPD', {}, [
      node('Period', {}, [
        node('AdaptationSet', { contentType: 'video' }, [
          node('Representation', { id: 'sidx' }, [
            node('SegmentBase', { indexRange: '0-99' }),
          ]),
        ]),
      ]),
    ])
    const sidxManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media.mp4',
      root: sidxRoot,
      text: '',
    })
    expect(sidxManifest.unsupportedReasons).toEqual([])
    expect(sidxManifest.representations[0].segmentBase).toEqual({
      indexRange: { length: 100, offset: 0, raw: '0-99' },
      presentationTimeOffset: undefined,
      timescale: undefined,
    })
    expect(sidxManifest.representations[0].segments).toEqual([])

    const invalidInitializationRangeRoot = node('MPD', {}, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'invalid-init-range' }, [
          node('SegmentBase', {}, [node('Initialization', { range: '40-39' })]),
        ]),
      ])]),
    ])
    const invalidInitializationRangeManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media.mp4',
      root: invalidInitializationRangeRoot,
      text: '',
    })
    expect(invalidInitializationRangeManifest.unsupportedReasons)
      .toContain('segment-base-initialization-range-invalid')
    expect(invalidInitializationRangeManifest.representations[0].segments).toEqual([])

    const invalidIndexRangeRoot = node('MPD', {}, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'invalid-index-range' }, [
          node('SegmentBase', { indexRange: '90-89' }),
        ]),
      ])]),
    ])
    const invalidIndexRangeManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media.mp4',
      root: invalidIndexRangeRoot,
      text: '',
    })
    expect(invalidIndexRangeManifest.unsupportedReasons)
      .toContain('segment-base-index-range-invalid')
    expect(invalidIndexRangeManifest.representations[0].segments).toEqual([])

    const multiPeriodRoot = node('MPD', {}, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'first' }, [node('SegmentList', {}, [
          node('SegmentURL', { media: 'first.m4s' }),
        ])]),
      ])]),
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'second' }, [node('SegmentList', {}, [
          node('SegmentURL', { media: 'second.m4s' }),
        ])]),
      ])]),
    ])
    const multiPeriodManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: multiPeriodRoot,
      text: '',
    })
    expect(multiPeriodManifest.unsupportedReasons).toContain('multi-period-not-expanded')
  })

  it('dash.multi-period-merge', () => {
    const root = node('MPD', { mediaPresentationDuration: 'PT4S' }, [
      node('Period', { duration: 'PT2S' }, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'main-video' }, [
          node('SegmentTemplate', {
            initialization: 'init.mp4',
            media: 'segment-$Time$.m4s',
            timescale: '1',
          }, [node('SegmentTimeline', {}, [node('S', { d: '1', r: '1', t: '0' })])]),
        ]),
      ])]),
      node('Period', { duration: 'PT2S' }, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'main-video' }, [
          node('SegmentTemplate', {
            initialization: 'init.mp4',
            media: 'segment-$Time$.m4s',
            timescale: '1',
          }, [node('SegmentTimeline', {}, [node('S', { d: '1', r: '1', t: '2' })])]),
        ]),
      ])]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root,
      text: '',
    })
    expect(manifest.unsupportedReasons).not.toContain('multi-period-not-expanded')
    expect(manifest.representations).toHaveLength(1)
    expect(manifest.representations[0]).toMatchObject({
      id: 'main-video',
      initializationUrl: 'https://cdn.example/media/init.mp4',
      segmentCount: 4,
    })
    expect(manifest.representations[0].segments.map(segment => segment.url)).toEqual([
      'https://cdn.example/media/segment-0.m4s',
      'https://cdn.example/media/segment-1.m4s',
      'https://cdn.example/media/segment-2.m4s',
      'https://cdn.example/media/segment-3.m4s',
    ])
    expect(manifest.representations[0].segments.map(segment => segment.index)).toEqual([0, 1, 2, 3])

    const conflictingInitRoot = node('MPD', {}, [
      node('Period', { duration: 'PT1S' }, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'conflicting-init' }, [
          node('SegmentTemplate', { initialization: 'init-a.mp4', duration: '1', media: 'a-$Number$.m4s' }),
        ]),
      ])]),
      node('Period', { duration: 'PT1S' }, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'conflicting-init' }, [
          node('SegmentTemplate', { initialization: 'init-b.mp4', duration: '1', media: 'b-$Number$.m4s' }),
        ]),
      ])]),
    ])
    const conflictingInitManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: conflictingInitRoot,
      text: '',
    })
    expect(conflictingInitManifest.unsupportedReasons).toEqual(expect.arrayContaining([
      'multi-period-not-expanded',
      'multi-period-initialization-conflict',
    ]))
    expect(conflictingInitManifest.representations).toHaveLength(2)
    expect(conflictingInitManifest.representations.map(item => item.initializationUrl)).toEqual([
      'https://cdn.example/media/init-a.mp4',
      'https://cdn.example/media/init-b.mp4',
    ])
  })

  it('dash.segment-list-boundary', () => {
    const root = node('MPD', {}, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'invalid-list' }, [
          node('SegmentList', {
            duration: '0',
            timescale: 'nope',
          }, [
            node('Initialization', { range: 'bad-range' }),
            node('SegmentURL', { media: '  ', mediaRange: '100-99' }),
          ]),
        ]),
      ])]),
    ])
    const manifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root,
      text: '',
    })
    expect(manifest.unsupportedReasons).toEqual(expect.arrayContaining([
      'segment-list-duration-invalid',
      'segment-list-timescale-invalid',
      'segment-list-initialization-range-invalid',
      'segment-list-media-url-missing',
      'segment-list-media-range-invalid',
    ]))
    expect(manifest.representations[0].segments).toEqual([{
      byteRange: undefined,
      duration: undefined,
      index: 0,
      url: '',
    }])
  })

  it('dash.segment-list-timeline', () => {
    const timelineRoot = node('MPD', {}, [
      node('Period', { duration: 'PT13S' }, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'timeline-list' }, [
          node('SegmentList', { startNumber: '10', timescale: '1' }, [
            node('SegmentTimeline', {}, [
              node('S', { d: '2', r: '1', t: '4' }),
              node('S', { d: '3', t: '10' }),
            ]),
            node('SegmentURL', { media: 'one.m4s' }),
            node('SegmentURL', { media: 'two.m4s' }),
            node('SegmentURL', { media: 'three.m4s' }),
          ]),
        ]),
      ])]),
    ])
    const timelineManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: timelineRoot,
      text: '',
    })
    expect(timelineManifest.unsupportedReasons).toEqual([])
    expect(timelineManifest.representations[0].segments).toEqual([
      { duration: 2, index: 0, number: 10, time: 4, url: 'https://cdn.example/media/one.m4s' },
      { duration: 2, index: 1, number: 11, time: 6, url: 'https://cdn.example/media/two.m4s' },
      { duration: 3, index: 2, number: 12, time: 10, url: 'https://cdn.example/media/three.m4s' },
    ])

    const conflictRoot = node('MPD', {}, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'timeline-conflict' }, [
          node('SegmentList', { duration: '2' }, [
            node('SegmentTimeline', {}, [node('S', { d: '2' })]),
            node('SegmentURL', { media: 'conflict.m4s' }),
          ]),
        ]),
      ])]),
    ])
    const conflictManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: conflictRoot,
      text: '',
    })
    expect(conflictManifest.unsupportedReasons)
      .toContain('segment-list-duration-and-timeline-conflict')

    const missingTimingRoot = node('MPD', {}, [
      node('Period', {}, [node('AdaptationSet', { contentType: 'video' }, [
        node('Representation', { id: 'missing-timing' }, [
          node('SegmentList', {}, [node('SegmentURL', { media: 'missing-timing.m4s' })]),
        ]),
      ])]),
    ])
    const missingTimingManifest = parseDashManifest({
      baseUrl: 'https://cdn.example/media/manifest.mpd',
      root: missingTimingRoot,
      text: '',
    })
    expect(missingTimingManifest.unsupportedReasons).toContain('segment-time-unspecified')
  })
})
