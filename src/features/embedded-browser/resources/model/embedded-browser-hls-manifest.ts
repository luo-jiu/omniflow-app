/**
 * HLS parsing behavior adapted from cat-catch m3u8 workflow.
 * Source: https://github.com/xifangczy/cat-catch
 * Licensed under AGPL-3.0
 */

export type EmbeddedBrowserHlsAttributeMap = Record<string, string>

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
  averageBandwidth?: number
  bandwidth?: number
  codecs?: string
  frameRate?: number
  rawAttributes: EmbeddedBrowserHlsAttributeMap
  rawLine: string
  resolution?: string
  subtitlesGroupId?: string
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
    url: string
  }>
  pageUrl?: string
  partCount: number
  renditions: Array<{
    groupId?: string
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
    bandwidth?: number
    codecs?: string
    resolution?: string
    url: string
  }>
}

type PendingSegment = {
  duration: number
  title?: string
}

function parseNumber(value?: string) {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBoolean(value?: string) {
  const normalizedValue = String(value || '').trim().toUpperCase()
  if (normalizedValue === 'YES') {
    return true
  }
  if (normalizedValue === 'NO') {
    return false
  }
  return undefined
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

function getTagValue(line: string) {
  const colonIndex = line.indexOf(':')
  return colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : ''
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

function resolveHlsUrl(uri: string, baseUrl: string) {
  const normalizedUri = String(uri || '').trim()
  if (!normalizedUri) {
    return ''
  }
  if (/^(data|blob|javascript):/i.test(normalizedUri)) {
    return normalizedUri
  }
  try {
    return new URL(normalizedUri, baseUrl).toString()
  } catch {
    return normalizedUri
  }
}

function parseExtinf(line: string): PendingSegment {
  const value = getTagValue(line)
  const commaIndex = value.indexOf(',')
  const durationText = commaIndex >= 0 ? value.slice(0, commaIndex) : value
  const title = commaIndex >= 0 ? value.slice(commaIndex + 1).trim() : undefined
  return {
    duration: parseNumber(durationText) || 0,
    title: title || undefined,
  }
}

function createHlsKey(line: string, baseUrl: string): EmbeddedBrowserHlsKey {
  const attributes = parseHlsAttributeList(getTagValue(line))
  const uri = attributes.URI
  return {
    iv: attributes.IV,
    keyFormat: attributes.KEYFORMAT,
    keyFormatVersions: attributes['KEYFORMATVERSIONS'],
    method: attributes.METHOD || 'NONE',
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : undefined,
  }
}

function createHlsMap(line: string, baseUrl: string): EmbeddedBrowserHlsMap | null {
  const attributes = parseHlsAttributeList(getTagValue(line))
  const uri = attributes.URI
  if (!uri) {
    return null
  }
  return {
    byteRange: parseHlsByteRange(attributes.BYTERANGE),
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url: resolveHlsUrl(uri, baseUrl),
  }
}

function createHlsVariant(line: string, uri: string, baseUrl: string): EmbeddedBrowserHlsVariant {
  const attributes = parseHlsAttributeList(getTagValue(line))
  return {
    audioGroupId: attributes.AUDIO,
    averageBandwidth: parseNumber(attributes['AVERAGE-BANDWIDTH']),
    bandwidth: parseNumber(attributes.BANDWIDTH),
    codecs: attributes.CODECS,
    frameRate: parseNumber(attributes['FRAME-RATE']),
    rawAttributes: attributes,
    rawLine: line,
    resolution: attributes.RESOLUTION,
    subtitlesGroupId: attributes.SUBTITLES,
    uri,
    url: resolveHlsUrl(uri, baseUrl),
  }
}

function createHlsRendition(line: string, baseUrl: string): EmbeddedBrowserHlsRendition {
  const attributes = parseHlsAttributeList(getTagValue(line))
  const uri = attributes.URI
  return {
    autoselect: parseBoolean(attributes.AUTOSELECT),
    default: parseBoolean(attributes.DEFAULT),
    forced: parseBoolean(attributes.FORCED),
    groupId: attributes['GROUP-ID'],
    language: attributes.LANGUAGE,
    name: attributes.NAME,
    rawAttributes: attributes,
    rawLine: line,
    type: attributes.TYPE,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : undefined,
  }
}

export function parseEmbeddedBrowserHlsManifest(input: {
  baseUrl: string
  text: string
}): EmbeddedBrowserHlsManifest {
  const baseUrl = String(input.baseUrl || '').trim()
  const lines = String(input.text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  let mediaSequence = 0
  let targetDuration: number | undefined
  let playlistType: string | undefined
  let hasEndList = false
  let discontinuitySequence = 0
  let currentKey: EmbeddedBrowserHlsKey | undefined
  let currentMap: EmbeddedBrowserHlsMap | undefined
  let pendingSegment: PendingSegment | undefined
  let pendingByteRange: EmbeddedBrowserHlsByteRange | undefined
  let pendingVariantLine: string | undefined

  const keys = new Map<string, EmbeddedBrowserHlsKey>()
  const maps = new Map<string, EmbeddedBrowserHlsMap>()
  const segments: EmbeddedBrowserHlsSegment[] = []
  const variants: EmbeddedBrowserHlsVariant[] = []
  const renditions: EmbeddedBrowserHlsRendition[] = []

  function rememberKey(key: EmbeddedBrowserHlsKey) {
    const keyId = `${key.method}:${key.url || key.uri || key.rawLine}:${key.iv || ''}`
    keys.set(keyId, key)
  }

  function rememberMap(map: EmbeddedBrowserHlsMap) {
    maps.set(`${map.url}:${map.byteRange?.raw || ''}`, map)
  }

  function addSegment(uri: string, part: boolean) {
    const normalizedUri = String(uri || '').trim()
    if (!normalizedUri) {
      return
    }
    const index = segments.length
    segments.push({
      byteRange: pendingByteRange,
      discontinuitySequence,
      duration: pendingSegment?.duration || 0,
      index,
      key: currentKey,
      map: currentMap,
      part,
      sequence: mediaSequence + index,
      title: pendingSegment?.title,
      uri: normalizedUri,
      url: resolveHlsUrl(normalizedUri, baseUrl),
    })
    pendingSegment = undefined
    pendingByteRange = undefined
  }

  lines.forEach((line) => {
    if (pendingVariantLine && !line.startsWith('#')) {
      variants.push(createHlsVariant(pendingVariantLine, line, baseUrl))
      pendingVariantLine = undefined
      return
    }

    if (!line.startsWith('#')) {
      addSegment(line, false)
      return
    }

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      pendingVariantLine = line
      return
    }

    if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
      const attributes = parseHlsAttributeList(getTagValue(line))
      if (attributes.URI) {
        variants.push(createHlsVariant(line, attributes.URI, baseUrl))
      }
      return
    }

    if (line.startsWith('#EXT-X-MEDIA:')) {
      renditions.push(createHlsRendition(line, baseUrl))
      return
    }

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = parseNumber(getTagValue(line)) || 0
      return
    }

    if (line.startsWith('#EXT-X-TARGETDURATION')) {
      targetDuration = parseNumber(getTagValue(line))
      return
    }

    if (line.startsWith('#EXT-X-PLAYLIST-TYPE')) {
      playlistType = getTagValue(line) || undefined
      return
    }

    if (line.startsWith('#EXT-X-KEY')) {
      const key = createHlsKey(line, baseUrl)
      rememberKey(key)
      currentKey = key.method.toUpperCase() === 'NONE' ? undefined : key
      return
    }

    if (line.startsWith('#EXT-X-MAP')) {
      const map = createHlsMap(line, baseUrl)
      if (map) {
        currentMap = map
        rememberMap(map)
      }
      return
    }

    if (line.startsWith('#EXT-X-BYTERANGE')) {
      pendingByteRange = parseHlsByteRange(getTagValue(line))
      return
    }

    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuitySequence += 1
      return
    }

    if (line.startsWith('#EXTINF')) {
      pendingSegment = parseExtinf(line)
      return
    }

    if (line.startsWith('#EXT-X-PART')) {
      const attributes = parseHlsAttributeList(getTagValue(line))
      pendingSegment = {
        duration: parseNumber(attributes.DURATION) || 0,
      }
      addSegment(attributes.URI || '', true)
      return
    }

    if (line.startsWith('#EXT-X-ENDLIST')) {
      hasEndList = true
    }
  })

  const durationSeconds = segments.reduce((total, segment) => total + segment.duration, 0)
  return {
    baseUrl,
    discontinuityCount: discontinuitySequence,
    durationSeconds,
    hasEndList,
    isLive: !hasEndList,
    isMaster: variants.length > 0,
    keys: Array.from(keys.values()),
    maps: Array.from(maps.values()),
    mediaSequence,
    playlistType,
    renditions,
    segmentCount: segments.length,
    segments,
    targetDuration,
    variants,
  }
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
      url: map.url,
    })),
    mapTag: manifest.maps[0]?.url || '',
    pageUrl: input.pageUrl,
    partCount: fragments.filter((fragment) => fragment.part).length,
    renditions: manifest.renditions.map((rendition) => ({
      groupId: rendition.groupId,
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
      bandwidth: variant.bandwidth,
      codecs: variant.codecs,
      resolution: variant.resolution,
      url: variant.url,
    })),
  }
}
