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

const mediaStructureFixtureRoot = fileURLToPath(new URL('../../../../../tools/cat-catch-lab/fixtures/hls-media-playlist-structure-errors', import.meta.url))
const mediaStructureFixture = JSON.parse(readFileSync(`${mediaStructureFixtureRoot}/fixture.json`, 'utf8')) as {
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

  it('hls.media-playlist-structure-rejection', () => {
    for (const input of mediaStructureFixture.inputs) {
      const text = readFileSync(`${mediaStructureFixtureRoot}/${input}`, 'utf8')
      expect(() => parseHlsManifest({
        baseUrl: `https://media.example/${input}`,
        text,
      }), input).toThrow(mediaStructureExpected[input])
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
      text: '#EXTM3U\n#EXT-X-DEFINE:NAME="root",VALUE="real.m3u8"\n#EXT-X-DEFINE:QUERYPARAM="literal"\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=120000,URI="{$literal}"\n',
    })
    expect(manifest.variants[0]?.uri).toBe('{$root}')
    expect(manifest.variants[0]?.url).toBe('https://example.test/%7B$root%7D')
  })
})
