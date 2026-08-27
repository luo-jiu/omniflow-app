import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  createEmbeddedBrowserHlsDownloadPlan,
  parseEmbeddedBrowserHlsManifest,
} from '../../../../../src/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import { parseHlsManifest } from './parser'

const fixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-byterange-implicit-offset', import.meta.url))
const fixture = JSON.parse(readFileSync(`${fixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const playlist = readFileSync(`${fixtureRoot}/${fixture.input}`, 'utf8')
const expected = JSON.parse(readFileSync(`${fixtureRoot}/${fixture.expected}`, 'utf8')) as {
  baseUrl: string
  durationSeconds: number
  hasEndList: boolean
  isLive: boolean
  isMaster: boolean
  maps: Array<{ length: number; offset: number; url: string }>
  mediaSequence: number
  segmentCount: number
  segments: Array<{
    discontinuitySequence: number
    duration: number
    keyUrl: string
    length: number
    mapUrl: string
    offset: number
    sequence: number
    title: string | null
    url: string
  }>
  targetDuration: number
}

const llHlsFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-low-latency-parts', import.meta.url))
const llHlsFixture = JSON.parse(readFileSync(`${llHlsFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const llHlsPlaylist = readFileSync(`${llHlsFixtureRoot}/${llHlsFixture.input}`, 'utf8')
const llHlsExpected = JSON.parse(readFileSync(`${llHlsFixtureRoot}/${llHlsFixture.expected}`, 'utf8')) as {
  baseUrl: string
  durationSeconds: number
  fragmentCount: number
  isLive: boolean
  partCount: number
  segmentCount: number
  segments: Array<{
    duration: number
    sequence: number
    url: string
  }>
}

const emptyMediaFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-empty-media-playlist', import.meta.url))
const emptyMediaFixture = JSON.parse(readFileSync(`${emptyMediaFixtureRoot}/fixture.json`, 'utf8')) as {
  expectedError: string
  inputs: string[]
}

const deltaPlaylistFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-delta-playlist-rejection', import.meta.url))
const deltaPlaylistFixture = JSON.parse(readFileSync(`${deltaPlaylistFixtureRoot}/fixture.json`, 'utf8')) as {
  allowed: Record<string, { sequence: number; url: string }>
  expectedError: string
  expectedRepeatedError: string
  inputs: {
    invalid: string
    positive: string
    repeated: string
    skipOnly: string
    zero: string
  }
}

const mediaStructureFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-media-playlist-structure-errors', import.meta.url))
const mediaStructureFixture = JSON.parse(readFileSync(`${mediaStructureFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  inputs: string[]
}

const singletonTagFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-media-playlist-singleton-tags', import.meta.url))
const singletonTagFixture = JSON.parse(readFileSync(`${singletonTagFixtureRoot}/fixture.json`, 'utf8')) as {
  allowed: string[]
  expected: string
  inputs: string[]
}
const mediaStructureExpected = JSON.parse(readFileSync(`${mediaStructureFixtureRoot}/${mediaStructureFixture.expected}`, 'utf8')) as Record<string, string>

const mapByteRangeFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-map-byterange-independent', import.meta.url))
const mapByteRangeFixture = JSON.parse(readFileSync(`${mapByteRangeFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const mapByteRangePlaylist = readFileSync(`${mapByteRangeFixtureRoot}/${mapByteRangeFixture.input}`, 'utf8')
const mapByteRangeExpected = JSON.parse(readFileSync(`${mapByteRangeFixtureRoot}/${mapByteRangeFixture.expected}`, 'utf8')) as {
  baseUrl: string
  maps: Array<{ length: number; offset: number; url: string }>
  segmentMapOffsets: number[]
}

const mapLeadingByteRangeFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-map-leading-byterange-transfer', import.meta.url))
const mapLeadingByteRangeFixture = JSON.parse(readFileSync(`${mapLeadingByteRangeFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const mapLeadingByteRangePlaylist = readFileSync(`${mapLeadingByteRangeFixtureRoot}/${mapLeadingByteRangeFixture.input}`, 'utf8')
const mapLeadingByteRangeExpected = JSON.parse(readFileSync(`${mapLeadingByteRangeFixtureRoot}/${mapLeadingByteRangeFixture.expected}`, 'utf8')) as {
  baseUrl: string
  maps: Array<{ length: number | null; offset: number | null; url: string }>
  segments: Array<{
    length: number
    mapLength: number | null
    mapOffset: number | null
    offset: number
    sequence: number
    url: string
  }>
}

const numericByteRangeFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-byterange-numeric-normalization', import.meta.url))
const numericByteRangeFixture = JSON.parse(readFileSync(`${numericByteRangeFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const numericByteRangePlaylist = readFileSync(`${numericByteRangeFixtureRoot}/${numericByteRangeFixture.input}`, 'utf8')
const numericByteRangeExpected = JSON.parse(readFileSync(`${numericByteRangeFixtureRoot}/${numericByteRangeFixture.expected}`, 'utf8')) as {
  baseUrl: string
  invalidByteRanges: string[]
  invalidError: string
  map: { length: number; offset: number; url: string }
  segments: Array<{
    length: number
    mapLength: number
    mapOffset: number
    offset: number
    sequence: number
    url: string
  }>
}

const mapUriFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-map-uri-rejection', import.meta.url))
const mapUriFixture = JSON.parse(readFileSync(`${mapUriFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  inputs: string[]
}
const mapUriExpected = JSON.parse(readFileSync(`${mapUriFixtureRoot}/${mapUriFixture.expected}`, 'utf8')) as {
  baseUrl: string
  expectedError: string
}

const aesIvFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-aes128-iv-semantics', import.meta.url))
const aesIvFixture = JSON.parse(readFileSync(`${aesIvFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const aesIvPlaylist = readFileSync(`${aesIvFixtureRoot}/${aesIvFixture.input}`, 'utf8')
const aesIvExpected = JSON.parse(readFileSync(`${aesIvFixtureRoot}/${aesIvFixture.expected}`, 'utf8')) as {
  baseUrl: string
  segments: Array<{ iv: string; keyUrl: string; sequence: number; url: string }>
}

const encryptedMapFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-encrypted-map-key-context', import.meta.url))
const encryptedMapFixture = JSON.parse(readFileSync(`${encryptedMapFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const encryptedMapPlaylist = readFileSync(`${encryptedMapFixtureRoot}/${encryptedMapFixture.input}`, 'utf8')
const encryptedMapExpected = JSON.parse(readFileSync(`${encryptedMapFixtureRoot}/${encryptedMapFixture.expected}`, 'utf8')) as {
  baseUrl: string
  maps: Array<{ iv: string; keyUrl: string; method: string; url: string }>
  segments: Array<{
    iv: string
    keyUrl: string
    mapIv: string
    mapKeyUrl: string
    sequence: number
    url: string
  }>
}

const masterVariantFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-master-variant-filtering', import.meta.url))
const masterVariantFixture = JSON.parse(readFileSync(`${masterVariantFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  inputs: {
    iframeOnly: string
    mixed: string
  }
}
const masterVariantExpected = JSON.parse(readFileSync(`${masterVariantFixtureRoot}/${masterVariantFixture.expected}`, 'utf8')) as {
  baseUrl: string
  iframeOnlyError: string
  renditions: Array<{ groupId: string; name: string; url: string }>
  variants: Array<{ bandwidth: number; codecs: string; url: string }>
}

const masterRenditionFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-master-rendition-projection', import.meta.url))
const masterRenditionFixture = JSON.parse(readFileSync(`${masterRenditionFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const masterRenditionExpected = JSON.parse(readFileSync(`${masterRenditionFixtureRoot}/${masterRenditionFixture.expected}`, 'utf8')) as {
  renditions: Array<{
    autoselect: boolean
    default: boolean
    forced: boolean
    groupId: string
    language?: string
    name: string
    type: string
    url: string
  }>
}

const masterVariantGroupFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-master-variant-group-merge', import.meta.url))
const masterVariantGroupFixture = JSON.parse(readFileSync(`${masterVariantGroupFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const masterVariantGroupExpected = JSON.parse(readFileSync(`${masterVariantGroupFixtureRoot}/${masterVariantGroupFixture.expected}`, 'utf8')) as {
  baseUrl: string
  variants: Array<{
    audioGroupId: string
    audioGroupIds: string[]
    subtitlesGroupId: string
    subtitlesGroupIds: string[]
    url: string
  }>
}

const masterPathwayFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-master-pathway-uri-boundary', import.meta.url))
const masterPathwayFixture = JSON.parse(readFileSync(`${masterPathwayFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  inputs: {
    explicit: string
    implicit: string
  }
}
type MasterPathwayExpectedVariant = {
  audioGroupId: string
  audioGroupIds: string[]
  pathwayId: string | null
  subtitlesGroupId: string
  subtitlesGroupIds: string[]
  url: string
}
const masterPathwayExpected = JSON.parse(readFileSync(`${masterPathwayFixtureRoot}/${masterPathwayFixture.expected}`, 'utf8')) as {
  baseUrl: string
  explicitVariants: MasterPathwayExpectedVariant[]
  variants: MasterPathwayExpectedVariant[]
}

const masterSessionKeyFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-master-session-key-boundary', import.meta.url))
const masterSessionKeyFixture = JSON.parse(readFileSync(`${masterSessionKeyFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  inputs: {
    child: string
    master: string
    missingVariable: string
  }
}
const masterSessionKeyExpected = JSON.parse(readFileSync(`${masterSessionKeyFixtureRoot}/${masterSessionKeyFixture.expected}`, 'utf8')) as {
  childBaseUrl: string
  childSegments: Array<{
    encrypted: boolean
    keyUrl: string | null
    sequence: number
    url: string
  }>
  masterBaseUrl: string
  masterDownloadKeyCount: number
  missingVariableError: string
  variantUrl: string
}

const keySupportFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-key-support-boundary', import.meta.url))
const keySupportFixture = JSON.parse(readFileSync(`${keySupportFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const keySupportPlaylist = readFileSync(`${keySupportFixtureRoot}/${keySupportFixture.input}`, 'utf8')
const keySupportExpected = JSON.parse(readFileSync(`${keySupportFixtureRoot}/${keySupportFixture.expected}`, 'utf8')) as {
  baseUrl: string
  keys: Array<{ keyFormat: string | null; method: string; url: string }>
  segments: Array<{
    encrypted: boolean
    iv: string | null
    keyFormat: string | null
    method: string | null
    sequence: number
    url: string
  }>
}

const keyIvFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-key-iv-normalization', import.meta.url))
const keyIvFixture = JSON.parse(readFileSync(`${keyIvFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  input: string
}
const keyIvExpected = JSON.parse(readFileSync(`${keyIvFixtureRoot}/${keyIvFixture.expected}`, 'utf8')) as {
  baseUrl: string
  segments: Array<{ iv: string; sequence: number; url: string }>
}

const variableFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-variable-substitution', import.meta.url))
const variableFixture = JSON.parse(readFileSync(`${variableFixtureRoot}/fixture.json`, 'utf8')) as {
  expected: string
  inputs: {
    master: string
    media: string
  }
}
const variableMasterPlaylist = readFileSync(`${variableFixtureRoot}/${variableFixture.inputs.master}`, 'utf8')
const variableMediaPlaylist = readFileSync(`${variableFixtureRoot}/${variableFixture.inputs.media}`, 'utf8')
const variableExpected = JSON.parse(readFileSync(`${variableFixtureRoot}/${variableFixture.expected}`, 'utf8')) as {
  key: { iv: string; url: string }
  map: { length: number; offset: number; url: string }
  masterBaseUrl: string
  masterVariables: Record<string, string>
  mediaVariables: Record<string, string>
  rendition: { groupId: string; name: string; url: string }
  segment: { sequence: number; url: string }
  variantUrls: string[]
}

function parseFixture() {
  return parseHlsManifest({
    baseUrl: expected.baseUrl,
    text: playlist,
  })
}

describe('Cat Catch HLS parser', () => {
  it('hls.parser-core', () => {
    const manifest = parseFixture()
    expect(manifest).toMatchObject({
      baseUrl: expected.baseUrl,
      durationSeconds: expected.durationSeconds,
      hasEndList: expected.hasEndList,
      isLive: expected.isLive,
      isMaster: expected.isMaster,
      mediaSequence: expected.mediaSequence,
      segmentCount: expected.segmentCount,
      targetDuration: expected.targetDuration,
    })
    expect(manifest.segments.map(segment => segment.url)).toEqual(expected.segments.map(segment => segment.url))

    const rendererFacadeManifest = parseEmbeddedBrowserHlsManifest({
      baseUrl: expected.baseUrl,
      text: playlist,
    })
    expect(rendererFacadeManifest.segments[1]?.byteRange).toMatchObject({
      length: 20,
      offset: 210,
    })
  })

  it('hls.byterange-map-key-discontinuity', () => {
    const manifest = parseFixture()
    expect(manifest.maps.map(map => ({
      length: map.byteRange?.length,
      offset: map.byteRange?.offset,
      url: map.url,
    }))).toEqual(expected.maps)
    expect(manifest.segments.map(segment => ({
      discontinuitySequence: segment.discontinuitySequence,
      duration: segment.duration,
      keyUrl: segment.key?.url,
      length: segment.byteRange?.length,
      mapUrl: segment.map?.url,
      offset: segment.byteRange?.offset,
      sequence: segment.sequence,
      title: segment.title || null,
      url: segment.url,
    }))).toEqual(expected.segments)
  })

  it('hls.map-byterange-independent', () => {
    const manifest = parseHlsManifest({
      baseUrl: mapByteRangeExpected.baseUrl,
      text: mapByteRangePlaylist,
    })
    expect(manifest.maps.map(map => ({
      length: map.byteRange?.length,
      offset: map.byteRange?.offset,
      url: map.url,
    }))).toEqual(mapByteRangeExpected.maps)
    expect(manifest.segments.map(segment => segment.map?.byteRange?.offset))
      .toEqual(mapByteRangeExpected.segmentMapOffsets)
  })

  it('hls.map-leading-byterange-transfer', () => {
    const manifest = parseHlsManifest({
      baseUrl: mapLeadingByteRangeExpected.baseUrl,
      text: mapLeadingByteRangePlaylist,
    })
    expect(manifest.maps.map(map => ({
      length: map.byteRange?.length || null,
      offset: map.byteRange?.offset ?? null,
      url: map.url,
    }))).toEqual(mapLeadingByteRangeExpected.maps)
    expect(manifest.segments.map(segment => ({
      length: segment.byteRange?.length,
      mapLength: segment.map?.byteRange?.length || null,
      mapOffset: segment.map?.byteRange?.offset ?? null,
      offset: segment.byteRange?.offset,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(mapLeadingByteRangeExpected.segments)

    const plan = createEmbeddedBrowserHlsDownloadPlan({
      manifest,
      manifestUrl: mapLeadingByteRangeExpected.baseUrl,
    })
    expect(plan.fragments.map(fragment => ({
      mapLength: fragment.initSegment?.byteRange?.length || null,
      mapOffset: fragment.initSegment?.byteRange?.offset ?? null,
    }))).toEqual(mapLeadingByteRangeExpected.segments.map(segment => ({
      mapLength: segment.mapLength,
      mapOffset: segment.mapOffset,
    })))

    const emptyMapRange = parseHlsManifest({
      baseUrl: mapLeadingByteRangeExpected.baseUrl,
      text: mapLeadingByteRangePlaylist.replace(
        '#EXT-X-MAP:URI="shared.mp4"',
        '#EXT-X-MAP:URI="shared.mp4",BYTERANGE=""',
      ),
    })
    expect(emptyMapRange.maps[0]?.byteRange).toMatchObject({
      length: 720,
      offset: 0,
    })
  })

  it('hls.map-uri-rejection', () => {
    for (const input of mapUriFixture.inputs) {
      expect(() => parseHlsManifest({
        baseUrl: mapUriExpected.baseUrl,
        text: readFileSync(`${mapUriFixtureRoot}/${input}`, 'utf8'),
      }), input).toThrow(mapUriExpected.expectedError)
    }
  })

  it('hls.byterange-numeric-normalization', () => {
    const manifest = parseHlsManifest({
      baseUrl: numericByteRangeExpected.baseUrl,
      text: numericByteRangePlaylist,
    })
    expect(manifest.maps[0]).toMatchObject({
      byteRange: {
        length: numericByteRangeExpected.map.length,
        offset: numericByteRangeExpected.map.offset,
      },
      url: numericByteRangeExpected.map.url,
    })
    expect(manifest.segments.map(segment => ({
      length: segment.byteRange?.length,
      mapLength: segment.map?.byteRange?.length,
      mapOffset: segment.map?.byteRange?.offset,
      offset: segment.byteRange?.offset,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(numericByteRangeExpected.segments)

    const plan = createEmbeddedBrowserHlsDownloadPlan({
      manifest,
      manifestUrl: numericByteRangeExpected.baseUrl,
    })
    expect(plan.fragments.map(fragment => ({
      length: fragment.byteRange?.length,
      mapLength: fragment.initSegment?.byteRange?.length,
      mapOffset: fragment.initSegment?.byteRange?.offset,
      offset: fragment.byteRange?.offset,
      sequence: fragment.sequence,
      url: fragment.url,
    }))).toEqual(numericByteRangeExpected.segments)

    for (const byteRange of numericByteRangeExpected.invalidByteRanges) {
      expect(() => parseHlsManifest({
        baseUrl: numericByteRangeExpected.baseUrl,
        text: numericByteRangePlaylist.replace(
          '#EXT-X-BYTERANGE:15.9tail@100.8tail',
          `#EXT-X-BYTERANGE:${byteRange}`,
        ),
      }), byteRange).toThrow(numericByteRangeExpected.invalidError)
    }
    expect(() => parseHlsManifest({
      baseUrl: numericByteRangeExpected.baseUrl,
      text: numericByteRangePlaylist.replace(
        'BYTERANGE="20.9tail@300.8tail"',
        'BYTERANGE="0@300"',
      ),
    })).toThrow(numericByteRangeExpected.invalidError)
  })

  it('hls.aes128-effective-iv', () => {
    const manifest = parseHlsManifest({
      baseUrl: aesIvExpected.baseUrl,
      text: aesIvPlaylist,
    })
    expect(manifest.segments.map(segment => ({
      iv: segment.key?.iv,
      keyUrl: segment.key?.url,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(aesIvExpected.segments)
  })

  it('hls.encrypted-map-key-context', () => {
    const manifest = parseHlsManifest({
      baseUrl: encryptedMapExpected.baseUrl,
      text: encryptedMapPlaylist,
    })
    expect(manifest.maps.map(map => ({
      iv: map.key?.iv,
      keyUrl: map.key?.url,
      method: map.key?.method,
      url: map.url,
    }))).toEqual(encryptedMapExpected.maps)
    expect(manifest.segments.map(segment => ({
      iv: segment.key?.iv,
      keyUrl: segment.key?.url,
      mapIv: segment.map?.key?.iv,
      mapKeyUrl: segment.map?.key?.url,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(encryptedMapExpected.segments)
  })

  it('hls.master-variant-filtering', () => {
    const manifest = parseHlsManifest({
      baseUrl: masterVariantExpected.baseUrl,
      text: readFileSync(`${masterVariantFixtureRoot}/${masterVariantFixture.inputs.mixed}`, 'utf8'),
    })
    expect(manifest.variants.map(variant => ({
      bandwidth: variant.bandwidth,
      codecs: variant.codecs,
      url: variant.url,
    }))).toEqual(masterVariantExpected.variants)
    expect(manifest.renditions.map(rendition => ({
      groupId: rendition.groupId,
      name: rendition.name,
      url: rendition.url,
    }))).toEqual(masterVariantExpected.renditions)
  })

  it('hls.master-no-levels-rejection', () => {
    expect(() => parseHlsManifest({
      baseUrl: masterVariantExpected.baseUrl,
      text: readFileSync(`${masterVariantFixtureRoot}/${masterVariantFixture.inputs.iframeOnly}`, 'utf8'),
    })).toThrow(masterVariantExpected.iframeOnlyError)
  })

  it('hls.master-rendition-projection', () => {
    const manifest = parseHlsManifest({
      baseUrl: 'https://media.example/master/index.m3u8',
      text: readFileSync(`${masterRenditionFixtureRoot}/${masterRenditionFixture.input}`, 'utf8'),
    })
    expect(manifest.renditions.map(rendition => ({
      autoselect: rendition.autoselect,
      default: rendition.default,
      forced: rendition.forced,
      groupId: rendition.groupId,
      language: rendition.language,
      name: rendition.name,
      type: rendition.type,
      url: rendition.url,
    }))).toEqual(masterRenditionExpected.renditions)
  })

  it('hls.master-variant-group-merge', () => {
    const manifest = parseHlsManifest({
      baseUrl: masterVariantGroupExpected.baseUrl,
      text: readFileSync(`${masterVariantGroupFixtureRoot}/${masterVariantGroupFixture.input}`, 'utf8'),
    })
    const projectVariant = (variant: typeof manifest.variants[number]) => ({
      audioGroupId: variant.audioGroupId,
      audioGroupIds: variant.audioGroupIds,
      subtitlesGroupId: variant.subtitlesGroupId,
      subtitlesGroupIds: variant.subtitlesGroupIds,
      url: variant.url,
    })
    expect(manifest.variants.map(projectVariant)).toEqual(masterVariantGroupExpected.variants)

    const plan = createEmbeddedBrowserHlsDownloadPlan({
      manifest,
      manifestUrl: masterVariantGroupExpected.baseUrl,
    })
    expect(plan.variants.map(variant => ({
      audioGroupId: variant.audioGroupId,
      audioGroupIds: variant.audioGroupIds,
      subtitlesGroupId: variant.subtitlesGroupId,
      subtitlesGroupIds: variant.subtitlesGroupIds,
      url: variant.url,
    }))).toEqual(masterVariantGroupExpected.variants)
  })

  it('hls.master-pathway-uri-boundary', () => {
    const projectVariants = (input: string) => parseHlsManifest({
      baseUrl: masterPathwayExpected.baseUrl,
      text: readFileSync(`${masterPathwayFixtureRoot}/${input}`, 'utf8'),
    }).variants.map(variant => ({
      audioGroupId: variant.audioGroupId,
      audioGroupIds: variant.audioGroupIds,
      pathwayId: variant.rawAttributes['PATHWAY-ID'] || null,
      subtitlesGroupId: variant.subtitlesGroupId,
      subtitlesGroupIds: variant.subtitlesGroupIds,
      url: variant.url,
    }))

    expect(projectVariants(masterPathwayFixture.inputs.implicit))
      .toEqual(masterPathwayExpected.variants)
    expect(projectVariants(masterPathwayFixture.inputs.explicit))
      .toEqual(masterPathwayExpected.explicitVariants)
  })

  it('hls.master-session-key-exclusion', () => {
    const master = parseHlsManifest({
      baseUrl: masterSessionKeyExpected.masterBaseUrl,
      text: readFileSync(`${masterSessionKeyFixtureRoot}/${masterSessionKeyFixture.inputs.master}`, 'utf8'),
    })
    expect(master.keys).toHaveLength(masterSessionKeyExpected.masterDownloadKeyCount)
    expect(master.variants.map(variant => variant.url)).toEqual([
      masterSessionKeyExpected.variantUrl,
    ])

    const child = parseHlsManifest({
      baseUrl: masterSessionKeyExpected.childBaseUrl,
      parentVariableList: master.variableList,
      text: readFileSync(`${masterSessionKeyFixtureRoot}/${masterSessionKeyFixture.inputs.child}`, 'utf8'),
    })
    expect(child.segments.map(segment => ({
      encrypted: segment.encrypted,
      keyUrl: segment.key?.url || null,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(masterSessionKeyExpected.childSegments)

    expect(() => parseHlsManifest({
      baseUrl: masterSessionKeyExpected.masterBaseUrl,
      text: readFileSync(`${masterSessionKeyFixtureRoot}/${masterSessionKeyFixture.inputs.missingVariable}`, 'utf8'),
    })).toThrow(masterSessionKeyExpected.missingVariableError)
  })

  it('hls.key-support-inheritance', () => {
    const manifest = parseHlsManifest({
      baseUrl: keySupportExpected.baseUrl,
      text: keySupportPlaylist,
    })
    expect(manifest.keys.map(key => ({
      keyFormat: key.keyFormat || null,
      method: key.method,
      url: key.url,
    }))).toEqual(keySupportExpected.keys)
    expect(manifest.segments.map(segment => ({
      encrypted: segment.encrypted,
      iv: segment.key?.iv || null,
      keyFormat: segment.key?.keyFormat || null,
      method: segment.key?.method || null,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(keySupportExpected.segments)
  })

  it('hls.key-iv-normalization', () => {
    const manifest = parseHlsManifest({
      baseUrl: keyIvExpected.baseUrl,
      text: readFileSync(`${keyIvFixtureRoot}/${keyIvFixture.input}`, 'utf8'),
    })
    expect(manifest.segments.map(segment => ({
      iv: segment.key?.iv,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(keyIvExpected.segments)

    const plan = createEmbeddedBrowserHlsDownloadPlan({
      manifest,
      manifestUrl: keyIvExpected.baseUrl,
    })
    expect(plan.fragments.map(fragment => ({
      iv: fragment.key?.iv,
      sequence: fragment.sequence,
      url: fragment.url,
    }))).toEqual(keyIvExpected.segments)
  })

  it('keeps normal master variants when every codec set is unknown', () => {
    const manifest = parseHlsManifest({
      baseUrl: masterVariantExpected.baseUrl,
      text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="future-video.1"\nfuture-video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,CODECS="future-audio.1"\nfuture-audio.m3u8\n',
    })
    expect(manifest.variants.map(variant => variant.url)).toEqual([
      'https://media.example/master/future-video.m3u8',
      'https://media.example/master/future-audio.m3u8',
    ])
  })

  it('hls.ll-parts-fragment-parity', () => {
    const manifest = parseHlsManifest({
      baseUrl: llHlsExpected.baseUrl,
      text: llHlsPlaylist,
    })
    const plan = createEmbeddedBrowserHlsDownloadPlan({
      manifest,
      manifestUrl: llHlsExpected.baseUrl,
    })

    expect(manifest).toMatchObject({
      durationSeconds: llHlsExpected.durationSeconds,
      isLive: llHlsExpected.isLive,
      segmentCount: llHlsExpected.segmentCount,
    })
    expect(manifest.segments.map(segment => ({
      duration: segment.duration,
      sequence: segment.sequence,
      url: segment.url,
    }))).toEqual(llHlsExpected.segments)
    expect(plan).toMatchObject({
      durationSeconds: llHlsExpected.durationSeconds,
      fragmentCount: llHlsExpected.fragmentCount,
      partCount: llHlsExpected.partCount,
      segmentCount: llHlsExpected.segmentCount,
    })
    expect(plan.fragments.every(fragment => !fragment.part)).toBe(true)
  })

  it('hls.empty-media-rejection', () => {
    for (const input of emptyMediaFixture.inputs) {
      const text = readFileSync(`${emptyMediaFixtureRoot}/${input}`, 'utf8')
      expect(() => parseHlsManifest({
        baseUrl: `https://media.example/${input}`,
        text,
      })).toThrow(emptyMediaFixture.expectedError)
    }
  })

  it('hls.delta-playlist-rejection', () => {
    for (const input of [deltaPlaylistFixture.inputs.positive, deltaPlaylistFixture.inputs.skipOnly]) {
      expect(() => parseHlsManifest({
        baseUrl: 'https://media.example/delta/live.m3u8',
        text: readFileSync(`${deltaPlaylistFixtureRoot}/${input}`, 'utf8'),
      })).toThrow(deltaPlaylistFixture.expectedError)
    }
    expect(() => parseHlsManifest({
      baseUrl: 'https://media.example/delta/live.m3u8',
      text: readFileSync(`${deltaPlaylistFixtureRoot}/${deltaPlaylistFixture.inputs.repeated}`, 'utf8'),
    })).toThrow(deltaPlaylistFixture.expectedRepeatedError)
    for (const input of [deltaPlaylistFixture.inputs.invalid, deltaPlaylistFixture.inputs.zero]) {
      const manifest = parseHlsManifest({
        baseUrl: 'https://media.example/delta/live.m3u8',
        text: readFileSync(`${deltaPlaylistFixtureRoot}/${input}`, 'utf8'),
      })
      expect(manifest.segments.map(segment => ({
        sequence: segment.sequence,
        url: segment.url,
      }))).toEqual([deltaPlaylistFixture.allowed[input]])
    }
  })

  it('hls.media-playlist-structure-rejection', () => {
    for (const input of mediaStructureFixture.inputs) {
      const text = readFileSync(`${mediaStructureFixtureRoot}/${input}`, 'utf8')
      expect(() => parseHlsManifest({
        baseUrl: `https://media.example/${input}`,
        text,
      }), input).toThrow(mediaStructureExpected[input])
    }
  })

  it('hls.media-playlist-singleton-tag-rejection', () => {
    const expected = JSON.parse(readFileSync(`${singletonTagFixtureRoot}/${singletonTagFixture.expected}`, 'utf8')) as Record<string, string>
    for (const input of singletonTagFixture.inputs) {
      expect(() => parseHlsManifest({
        baseUrl: 'https://media.example/singletons/live.m3u8',
        text: readFileSync(`${singletonTagFixtureRoot}/${input}`, 'utf8'),
      })).toThrow(expected[input])
    }

    for (const input of singletonTagFixture.allowed) {
      const manifest = parseHlsManifest({
        baseUrl: 'https://media.example/singletons/live.m3u8',
        text: readFileSync(`${singletonTagFixtureRoot}/${input}`, 'utf8'),
      })
      expect(manifest.segments.map(segment => ({
        sequence: segment.sequence,
        url: segment.url,
      }))).toEqual([{
        sequence: 0,
        url: 'https://media.example/singletons/segment.ts',
      }])
      expect(manifest.isLive).toBe(input !== 'singletons.m3u8')
    }
  })

  it('normalizes integer media tags like pinned hls.js', () => {
    const manifest = parseHlsManifest({
      baseUrl: 'https://media.example/normalized.m3u8',
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:0\n#EXT-X-PLAYLIST-TYPE:event\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n',
    })
    expect(manifest).toMatchObject({
      playlistType: 'EVENT',
      targetDuration: 1,
    })
  })

  it('hls.variable-substitution', () => {
    const master = parseHlsManifest({
      baseUrl: variableExpected.masterBaseUrl,
      text: variableMasterPlaylist,
    })
    expect(master.variableList).toEqual(variableExpected.masterVariables)
    expect(master.variants.map(variant => variant.url)).toEqual(variableExpected.variantUrls)
    expect(master.renditions[0]).toMatchObject(variableExpected.rendition)

    const media = parseHlsManifest({
      baseUrl: variableExpected.variantUrls[0],
      parentVariableList: master.variableList,
      text: variableMediaPlaylist,
    })
    expect(media.variableList).toEqual(variableExpected.mediaVariables)
    expect(media.keys[0]).toMatchObject(variableExpected.key)
    expect(media.maps[0]).toMatchObject({
      byteRange: {
        length: variableExpected.map.length,
        offset: variableExpected.map.offset,
      },
      url: variableExpected.map.url,
    })
    expect(media.segments[0]).toMatchObject(variableExpected.segment)

    const facadeMedia = parseEmbeddedBrowserHlsManifest({
      baseUrl: variableExpected.variantUrls[0],
      parentVariableList: master.variableList,
      text: variableMediaPlaylist,
    })
    expect(facadeMedia.segments[0]?.url).toBe(variableExpected.segment.url)
  })

  it('preserves pinned hls.js EXT-X-DEFINE failure semantics', () => {
    expect(() => parseHlsManifest({
      baseUrl: 'https://example.test/media.m3u8',
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-DEFINE:NAME="dup",VALUE="one"\n#EXT-X-DEFINE:NAME="dup",VALUE="two"\n#EXTINF:4,\n{$missing}/segment.ts\n',
    })).toThrow('EXT-X-DEFINE duplicate Variable Name declarations: "dup"')

    expect(() => parseHlsManifest({
      baseUrl: 'https://example.test/media.m3u8',
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-DEFINE:QUERYPARAM="missing"\n#EXTINF:4,\nsegment.ts\n',
    })).toThrow('EXT-X-DEFINE QUERYPARAM: "missing" does not match any query parameter in URI: "https://example.test/media.m3u8"')

    expect(() => parseHlsManifest({
      baseUrl: 'https://example.test/media.m3u8',
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-DEFINE:IMPORT="root"\n#EXTINF:4,\nsegment.ts\n',
    })).toThrow('EXT-X-DEFINE IMPORT attribute not found in Multivariant Playlist: "root"')

    expect(() => parseHlsManifest({
      baseUrl: 'https://example.test/media.m3u8',
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n{$missing}/segment.ts\n',
    })).toThrow('Missing preceding EXT-X-DEFINE tag for Variable Reference: "missing"')

    expect(() => parseHlsManifest({
      baseUrl: 'https://example.test/media.m3u8',
      parentVariableList: { root: 'https://cdn.example/assets' },
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n{$root}/segment.ts\n',
    })).toThrow('Missing preceding EXT-X-DEFINE tag for Variable Reference: "root"')
  })

  it('does not substitute an unquoted non-hexadecimal attribute', () => {
    const manifest = parseHlsManifest({
      baseUrl: 'https://example.test/master.m3u8',
      text: '#EXTM3U\n#EXT-X-DEFINE:NAME="bandwidth",VALUE="1280000"\n#EXT-X-STREAM-INF:BANDWIDTH={$bandwidth}\nvariant.m3u8\n',
    })
    expect(manifest.variants[0]?.bandwidth).toBeUndefined()
    expect(manifest.variants[0]?.rawAttributes.BANDWIDTH).toBe('{$bandwidth}')
  })

  it('substitutes each variable reference only once', () => {
    const manifest = parseHlsManifest({
      baseUrl: 'https://example.test/master.m3u8?literal=%7B%24root%7D',
      text: '#EXTM3U\n#EXT-X-DEFINE:NAME="root",VALUE="real.m3u8"\n#EXT-X-DEFINE:QUERYPARAM="literal"\n#EXT-X-STREAM-INF:BANDWIDTH=120000\n{$literal}\n',
    })
    expect(manifest.variants[0]?.uri).toBe('{$root}')
    expect(manifest.variants[0]?.url).toBe('https://example.test/%7B$root%7D')
  })
})
