/**
 * HLS parsing behavior adapted from cat-catch m3u8 workflow.
 * Source: https://github.com/xifangczy/cat-catch
 * Licensed under GPL-3.0-only
 */

import { parseHlsManifest } from '../../../../../electron/service/embedded-browser/cat-catch-port/hls/parser'

export type EmbeddedBrowserHlsAttributeMap = Record<string, string>

export type EmbeddedBrowserHlsVariableList = Record<string, string>

export type EmbeddedBrowserHlsByteRange = {
  length: number
  offset?: number
  raw: string
}

export type EmbeddedBrowserHlsKey = {
  iv?: string
  keyFormat?: string
  keyFormatVersions?: string
  method: string
  rawAttributes: EmbeddedBrowserHlsAttributeMap
  rawLine: string
  uri?: string
  url?: string
}

export type EmbeddedBrowserHlsMap = {
  byteRange?: EmbeddedBrowserHlsByteRange
  key?: EmbeddedBrowserHlsKey
  rawAttributes: EmbeddedBrowserHlsAttributeMap
  rawLine: string
  uri: string
  url: string
}

export type EmbeddedBrowserHlsSegment = {
  byteRange?: EmbeddedBrowserHlsByteRange
  discontinuitySequence: number
  duration: number
  index: number
  key?: EmbeddedBrowserHlsKey
  map?: EmbeddedBrowserHlsMap
  part: boolean
  sequence: number
  title?: string
  uri: string
  url: string
}

export type EmbeddedBrowserHlsVariant = {
  audioGroupId?: string
  audioGroupIds?: string[]
  averageBandwidth?: number
  bandwidth?: number
  codecs?: string
  frameRate?: number
  rawAttributes: EmbeddedBrowserHlsAttributeMap
  rawLine: string
  resolution?: string
  subtitlesGroupId?: string
  subtitlesGroupIds?: string[]
  uri: string
  url: string
}

export type EmbeddedBrowserHlsRendition = {
  autoselect?: boolean
  default?: boolean
  forced?: boolean
  groupId?: string
  language?: string
  name?: string
  rawAttributes: EmbeddedBrowserHlsAttributeMap
  rawLine: string
  type?: string
  uri?: string
  url?: string
}

export type EmbeddedBrowserHlsManifest = {
  baseUrl: string
  discontinuityCount: number
  durationSeconds: number
  hasEndList: boolean
  isLive: boolean
  isMaster: boolean
  keys: EmbeddedBrowserHlsKey[]
  maps: EmbeddedBrowserHlsMap[]
  mediaSequence: number
  playlistType?: string
  renditions: EmbeddedBrowserHlsRendition[]
  segmentCount: number
  segments: EmbeddedBrowserHlsSegment[]
  targetDuration?: number
  variableList?: EmbeddedBrowserHlsVariableList
  variants: EmbeddedBrowserHlsVariant[]
}

export type EmbeddedBrowserHlsDownloadKeyRef = {
  iv?: string
  keyFormat?: string
  method: string
  url?: string
}

export type EmbeddedBrowserHlsDownloadMapRef = {
  byteRange?: EmbeddedBrowserHlsByteRange
  key?: EmbeddedBrowserHlsDownloadKeyRef
  url: string
}

export type EmbeddedBrowserHlsDownloadFragment = {
  byteRange?: EmbeddedBrowserHlsByteRange
  discontinuitySequence: number
  duration: number
  index: number
  initSegment?: EmbeddedBrowserHlsDownloadMapRef
  key?: EmbeddedBrowserHlsDownloadKeyRef
  part: boolean
  sequence: number
  title?: string
  url: string
}

export type EmbeddedBrowserHlsDownloadPlan = {
  durationSeconds: number
  encryptedSegmentCount: number
  fragmentCount: number
  fragments: EmbeddedBrowserHlsDownloadFragment[]
  headers: Record<string, string>
  isLive: boolean
  isMaster: boolean
  keys: Array<{
    iv?: string
    keyFormat?: string
    method: string
    url?: string
  }>
  manifestUrl: string
  mapTag: string
  maps: Array<{
    byteRange?: EmbeddedBrowserHlsByteRange
    key?: EmbeddedBrowserHlsDownloadKeyRef
    url: string
  }>
  pageUrl?: string
  partCount: number
  renditions: Array<{
    autoselect?: boolean
    default?: boolean
    forced?: boolean
    groupId?: string
    language?: string
    name?: string
    type?: string
    url?: string
  }>
  segmentCount: number
  segments: Array<{
    byteRange?: EmbeddedBrowserHlsByteRange
    discontinuitySequence: number
    duration: number
    keyUrl?: string
    mapUrl?: string
    part: boolean
    sequence: number
    url: string
  }>
  suggestedThreadCount: number
  variants: Array<{
    audioGroupId?: string
    audioGroupIds?: string[]
    averageBandwidth?: number
    bandwidth?: number
    codecs?: string
    frameRate?: number
    resolution?: string
    subtitlesGroupId?: string
    subtitlesGroupIds?: string[]
    url: string
  }>
}

function parseNumber(value?: string) {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseHlsAttributeList(input: string): EmbeddedBrowserHlsAttributeMap {
  const result: EmbeddedBrowserHlsAttributeMap = {}
  let key = ''
  let value = ''
  let readingKey = true
  let inQuotes = false

  function commit() {
    const normalizedKey = key.trim()
    if (!normalizedKey) {
      key = ''
      value = ''
      readingKey = true
      return
    }
    let normalizedValue = value.trim()
    if (normalizedValue.startsWith('"') && normalizedValue.endsWith('"')) {
      normalizedValue = normalizedValue.slice(1, -1)
    }
    result[normalizedKey] = normalizedValue
    key = ''
    value = ''
    readingKey = true
  }

  Array.from(String(input || '')).forEach((char) => {
    if (readingKey) {
      if (char === '=') {
        readingKey = false
      } else {
        key += char
      }
      return
    }
    if (char === '"') {
      inQuotes = !inQuotes
      value += char
      return
    }
    if (char === ',' && !inQuotes) {
      commit()
      return
    }
    value += char
  })
  commit()
  return result
}

export function parseHlsByteRange(input?: string): EmbeddedBrowserHlsByteRange | undefined {
  const normalizedInput = String(input || '').trim()
  if (!normalizedInput) {
    return undefined
  }
  const [lengthText, offsetText] = normalizedInput.split('@')
  const length = parseNumber(lengthText)
  if (!length || length <= 0) {
    return undefined
  }
  const offset = parseNumber(offsetText)
  return {
    length,
    offset,
    raw: normalizedInput,
  }
}

export function parseEmbeddedBrowserHlsManifest(input: {
  baseUrl: string
  parentVariableList?: Readonly<EmbeddedBrowserHlsVariableList>
  text: string
}): EmbeddedBrowserHlsManifest {
  return parseHlsManifest(input)
}

export function createEmbeddedBrowserHlsDownloadPlan(input: {
  headers?: Record<string, string>
  manifest: EmbeddedBrowserHlsManifest
  manifestUrl: string
  pageUrl?: string
}): EmbeddedBrowserHlsDownloadPlan {
  const { manifest } = input
  const fragments = manifest.segments.map((segment) => ({
    byteRange: segment.byteRange,
    discontinuitySequence: segment.discontinuitySequence,
    duration: segment.duration,
    index: segment.index,
    initSegment: segment.map ? {
      byteRange: segment.map.byteRange,
      key: segment.map.key ? {
        iv: segment.map.key.iv,
        keyFormat: segment.map.key.keyFormat,
        method: segment.map.key.method,
        url: segment.map.key.url,
      } : undefined,
      url: segment.map.url,
    } : undefined,
    key: segment.key ? {
      iv: segment.key.iv,
      keyFormat: segment.key.keyFormat,
      method: segment.key.method,
      url: segment.key.url,
    } : undefined,
    part: segment.part,
    sequence: segment.sequence,
    title: segment.title,
    url: segment.url,
  }))
  const suggestedThreadCount = Math.min(6, Math.max(1, fragments.length || 1))
  return {
    durationSeconds: manifest.durationSeconds,
    encryptedSegmentCount: fragments.filter((fragment) => fragment.key?.url || fragment.key?.method === 'AES-128').length,
    fragmentCount: fragments.length,
    fragments,
    headers: input.headers || {},
    isLive: manifest.isLive,
    isMaster: manifest.isMaster,
    keys: manifest.keys.map((key) => ({
      iv: key.iv,
      keyFormat: key.keyFormat,
      method: key.method,
      url: key.url,
    })),
    manifestUrl: input.manifestUrl,
    maps: manifest.maps.map((map) => ({
      byteRange: map.byteRange,
      key: map.key ? {
        iv: map.key.iv,
        keyFormat: map.key.keyFormat,
        method: map.key.method,
        url: map.key.url,
      } : undefined,
      url: map.url,
    })),
    mapTag: manifest.maps[0]?.url || '',
    pageUrl: input.pageUrl,
    partCount: fragments.filter((fragment) => fragment.part).length,
    renditions: manifest.renditions.map((rendition) => ({
      autoselect: rendition.autoselect,
      default: rendition.default,
      forced: rendition.forced,
      groupId: rendition.groupId,
      language: rendition.language,
      name: rendition.name,
      type: rendition.type,
      url: rendition.url,
    })),
    segmentCount: manifest.segmentCount,
    segments: manifest.segments.map((segment) => ({
      byteRange: segment.byteRange,
      discontinuitySequence: segment.discontinuitySequence,
      duration: segment.duration,
      keyUrl: segment.key?.url,
      mapUrl: segment.map?.url,
      part: segment.part,
      sequence: segment.sequence,
      url: segment.url,
    })),
    suggestedThreadCount,
    variants: manifest.variants.map((variant) => ({
      audioGroupId: variant.audioGroupId,
      audioGroupIds: variant.audioGroupIds ? [...variant.audioGroupIds] : undefined,
      averageBandwidth: variant.averageBandwidth,
      bandwidth: variant.bandwidth,
      codecs: variant.codecs,
      frameRate: variant.frameRate,
      resolution: variant.resolution,
      subtitlesGroupId: variant.subtitlesGroupId,
      subtitlesGroupIds: variant.subtitlesGroupIds ? [...variant.subtitlesGroupIds] : undefined,
      url: variant.url,
    })),
  }
}
