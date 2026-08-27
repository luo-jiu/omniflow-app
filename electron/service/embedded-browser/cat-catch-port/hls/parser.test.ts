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
})
