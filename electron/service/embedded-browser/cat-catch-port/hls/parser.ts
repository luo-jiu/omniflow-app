/**
 * HLS parser behavior ported from the pinned Cat Catch dependency.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#Fragment.setByteRange and parseLevelPlaylist
 * Reason: hls.js carries an omitted BYTERANGE offset forward for the same
 * resource; losing that state makes every later range start at byte zero.
 * Adaptation: pure parser only; Electron fetching and output stay outside the port.
 * Fixture: hls.byterange-map-key-discontinuity
 */

export type CatCatchHlsAttributeMap = Record<string, string>

export type CatCatchHlsByteRange = {
  length: number
  offset?: number
  raw: string
}

export type CatCatchHlsKey = {
  iv?: string
  keyFormat?: string
  keyFormatVersions?: string
  method: string
  rawAttributes: CatCatchHlsAttributeMap
  rawLine: string
  uri?: string
  url?: string
}

export type CatCatchHlsMap = {
  byteRange?: CatCatchHlsByteRange
  rawAttributes: CatCatchHlsAttributeMap
  rawLine: string
  uri: string
  url: string
}

export type CatCatchHlsSegment = {
  byteRange?: CatCatchHlsByteRange
  discontinuitySequence: number
  duration: number
  index: number
  key?: CatCatchHlsKey
  map?: CatCatchHlsMap
  part: boolean
  sequence: number
  title?: string
  uri: string
  url: string
}

export type CatCatchHlsVariant = {
  audioGroupId?: string
  averageBandwidth?: number
  bandwidth?: number
  codecs?: string
  frameRate?: number
  rawAttributes: CatCatchHlsAttributeMap
  rawLine: string
  resolution?: string
  subtitlesGroupId?: string
  uri: string
  url: string
}

export type CatCatchHlsRendition = {
  autoselect?: boolean
  default?: boolean
  forced?: boolean
  groupId?: string
  language?: string
  name?: string
  rawAttributes: CatCatchHlsAttributeMap
  rawLine: string
  type?: string
  uri?: string
  url?: string
}

export type CatCatchHlsManifest = {
  baseUrl: string
  discontinuityCount: number
  durationSeconds: number
  hasEndList: boolean
  isLive: boolean
  isMaster: boolean
  keys: CatCatchHlsKey[]
  maps: CatCatchHlsMap[]
  mediaSequence: number
  playlistType?: string
  renditions: CatCatchHlsRendition[]
  segmentCount: number
  segments: CatCatchHlsSegment[]
  targetDuration?: number
  variants: CatCatchHlsVariant[]
}

type PendingSegment = {
  duration: number
  title?: string
}

function parseNumber(value?: string) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBoolean(value?: string) {
  const normalizedValue = String(value || '').trim().toUpperCase()
  if (normalizedValue === 'YES') return true
  if (normalizedValue === 'NO') return false
  return undefined
}

export function parseHlsAttributeList(input: string): CatCatchHlsAttributeMap {
  const result: CatCatchHlsAttributeMap = {}
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

  for (const char of String(input || '')) {
    if (readingKey) {
      if (char === '=') readingKey = false
      else key += char
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      value += char
      continue
    }
    if (char === ',' && !inQuotes) {
      commit()
      continue
    }
    value += char
  }
  commit()
  return result
}

export function parseHlsByteRange(input?: string): CatCatchHlsByteRange | undefined {
  const normalizedInput = String(input || '').trim()
  if (!normalizedInput) return undefined
  const [lengthText, offsetText] = normalizedInput.split('@', 2)
  const length = parseNumber(lengthText)
  if (!length || length <= 0) return undefined
  const offset = parseNumber(offsetText)
  return { length, offset, raw: normalizedInput }
}

function resolveHlsUrl(uri: string, baseUrl: string) {
  const normalizedUri = String(uri || '').trim()
  if (!normalizedUri) return ''
  if (/^(data|blob|javascript):/i.test(normalizedUri)) return normalizedUri
  try {
    return new URL(normalizedUri, baseUrl).toString()
  } catch {
    return normalizedUri
  }
}

function getTagValue(line: string) {
  const colonIndex = line.indexOf(':')
  return colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : ''
}

function parseExtinf(line: string): PendingSegment {
  const value = getTagValue(line)
  const commaIndex = value.indexOf(',')
  const durationText = commaIndex >= 0 ? value.slice(0, commaIndex) : value
  const title = commaIndex >= 0 ? value.slice(commaIndex + 1).trim() : undefined
  return { duration: parseNumber(durationText) || 0, title: title || undefined }
}

function createHlsKey(line: string, baseUrl: string): CatCatchHlsKey {
  const attributes = parseHlsAttributeList(getTagValue(line))
  const uri = attributes.URI
  return {
    iv: attributes.IV,
    keyFormat: attributes.KEYFORMAT,
    keyFormatVersions: attributes.KEYFORMATVERSIONS,
    method: attributes.METHOD || 'NONE',
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : undefined,
  }
}

function createHlsMap(
  line: string,
  baseUrl: string,
  rangeEnds: Map<string, number>,
): CatCatchHlsMap | null {
  const attributes = parseHlsAttributeList(getTagValue(line))
  const uri = attributes.URI
  if (!uri) return null
  const url = resolveHlsUrl(uri, baseUrl)
  return {
    byteRange: resolveByteRange(parseHlsByteRange(attributes.BYTERANGE), url, rangeEnds),
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url,
  }
}

function createHlsVariant(line: string, uri: string, baseUrl: string): CatCatchHlsVariant {
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

function createHlsRendition(line: string, baseUrl: string): CatCatchHlsRendition {
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

function resolveByteRange(
  byteRange: CatCatchHlsByteRange | undefined,
  resourceUrl: string,
  rangeEnds: Map<string, number>,
) {
  if (!byteRange) return undefined
  const previousEnd = rangeEnds.get(resourceUrl)
  const offset = byteRange.offset ?? previousEnd ?? 0
  const resolved = { ...byteRange, offset }
  rangeEnds.set(resourceUrl, offset + byteRange.length)
  return resolved
}

export function parseHlsManifest(input: {
  baseUrl: string
  text: string
}): CatCatchHlsManifest {
  const baseUrl = String(input.baseUrl || '').trim()
  const lines = String(input.text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  let mediaSequence = 0
  let targetDuration: number | undefined
  let playlistType: string | undefined
  let hasEndList = false
  let discontinuitySequence = 0
  let currentKey: CatCatchHlsKey | undefined
  let currentMap: CatCatchHlsMap | undefined
  let pendingSegment: PendingSegment | undefined
  let pendingByteRange: CatCatchHlsByteRange | undefined
  let pendingVariantLine: string | undefined

  const keys = new Map<string, CatCatchHlsKey>()
  const maps = new Map<string, CatCatchHlsMap>()
  const segments: CatCatchHlsSegment[] = []
  const variants: CatCatchHlsVariant[] = []
  const renditions: CatCatchHlsRendition[] = []
  const segmentRangeEnds = new Map<string, number>()
  const mapRangeEnds = new Map<string, number>()

  function rememberKey(key: CatCatchHlsKey) {
    const keyId = `${key.method}:${key.url || key.uri || key.rawLine}:${key.iv || ''}`
    keys.set(keyId, key)
  }

  function rememberMap(map: CatCatchHlsMap) {
    maps.set(`${map.url}:${map.byteRange?.raw || ''}:${map.byteRange?.offset ?? ''}`, map)
  }

  function addSegment(uri: string, part: boolean, byteRange = pendingByteRange) {
    const normalizedUri = String(uri || '').trim()
    if (!normalizedUri) return
    const url = resolveHlsUrl(normalizedUri, baseUrl)
    const index = segments.length
    segments.push({
      byteRange: resolveByteRange(byteRange, url, segmentRangeEnds),
      discontinuitySequence,
      duration: pendingSegment?.duration || 0,
      index,
      key: currentKey,
      map: currentMap,
      part,
      sequence: mediaSequence + index,
      title: pendingSegment?.title,
      uri: normalizedUri,
      url,
    })
    pendingSegment = undefined
    pendingByteRange = undefined
  }

  for (const line of lines) {
    if (pendingVariantLine && !line.startsWith('#')) {
      variants.push(createHlsVariant(pendingVariantLine, line, baseUrl))
      pendingVariantLine = undefined
      continue
    }
    if (!line.startsWith('#')) {
      addSegment(line, false)
      continue
    }
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      pendingVariantLine = line
      continue
    }
    if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
      const attributes = parseHlsAttributeList(getTagValue(line))
      if (attributes.URI) variants.push(createHlsVariant(line, attributes.URI, baseUrl))
      continue
    }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      renditions.push(createHlsRendition(line, baseUrl))
      continue
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = parseNumber(getTagValue(line)) || 0
      continue
    }
    if (line.startsWith('#EXT-X-TARGETDURATION')) {
      targetDuration = parseNumber(getTagValue(line))
      continue
    }
    if (line.startsWith('#EXT-X-PLAYLIST-TYPE')) {
      playlistType = getTagValue(line) || undefined
      continue
    }
    if (line.startsWith('#EXT-X-KEY')) {
      const key = createHlsKey(line, baseUrl)
      rememberKey(key)
      currentKey = key.method.toUpperCase() === 'NONE' ? undefined : key
      continue
    }
    if (line.startsWith('#EXT-X-MAP')) {
      const map = createHlsMap(line, baseUrl, mapRangeEnds)
      if (map) {
        currentMap = map
        rememberMap(map)
      }
      continue
    }
    if (line.startsWith('#EXT-X-BYTERANGE')) {
      pendingByteRange = parseHlsByteRange(getTagValue(line))
      continue
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')) {
      discontinuitySequence = parseNumber(getTagValue(line)) || 0
      continue
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuitySequence += 1
      continue
    }
    if (line.startsWith('#EXTINF')) {
      pendingSegment = parseExtinf(line)
      continue
    }
    if (line.startsWith('#EXT-X-PART')) {
      const attributes = parseHlsAttributeList(getTagValue(line))
      pendingSegment = { duration: parseNumber(attributes.DURATION) || 0 }
      addSegment(attributes.URI || '', true, parseHlsByteRange(attributes.BYTERANGE) || pendingByteRange)
      continue
    }
    if (line.startsWith('#EXT-X-ENDLIST')) hasEndList = true
  }

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
