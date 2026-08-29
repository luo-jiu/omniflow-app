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
    expect(sidxManifest.unsupportedReasons).toContain('segment-base-sidx-not-expanded')
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
})
