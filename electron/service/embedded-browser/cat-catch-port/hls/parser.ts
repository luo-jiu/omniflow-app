/**
 * HLS parser behavior ported from the pinned Cat Catch dependency.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#Fragment.setByteRange and parseLevelPlaylist
 * Reason: hls.js carries an omitted media BYTERANGE offset from the immediately
 * previous fragment, while each EXT-X-MAP range is parsed independently.
 * Adaptation: pure parser only; Electron fetching and output stay outside the port.
 * Fixtures: hls.byterange-map-key-discontinuity, hls.map-byterange-independent,
 * hls.map-leading-byterange-transfer, hls-valued-tag-boundary,
 * hls-extinf-token-boundary, hls-empty-valued-tag-boundary,
 * hls-whitespace-valued-tag-boundary, hls-media-parser-mode-isolation,
 * hls-master-parser-mode-isolation, hls-line-ending-boundary,
 * hls-master-pending-variant-boundary, hls-master-rendition-boolean-boundary
 */

import { createHlsDefaultIv } from './decrypt'

export type CatCatchHlsAttributeMap = Record<string, string>

export type CatCatchHlsVariableList = Record<string, string>

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
  key?: CatCatchHlsKey
  rawAttributes: CatCatchHlsAttributeMap
  rawLine: string
  uri: string
  url: string
}

export type CatCatchHlsSegment = {
  byteRange?: CatCatchHlsByteRange
  discontinuitySequence: number
  duration: number
  encrypted: boolean
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
  audioGroupIds?: string[]
  averageBandwidth?: number
  bandwidth?: number
  codecs?: string
  frameRate?: number
  rawAttributes: CatCatchHlsAttributeMap
  rawLine: string
  resolution?: string
  subtitlesGroupId?: string
  subtitlesGroupIds?: string[]
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
  variableList?: CatCatchHlsVariableList
  variants: CatCatchHlsVariant[]
}

type PendingSegment = {
  duration: number
  title?: string
}

type ParsedExtinf = {
  inlineUri?: string
  segment: PendingSegment
}

type HlsVariableState = {
  baseUrl: string
  parentVariableList?: Readonly<CatCatchHlsVariableList>
  playlistParsingError?: Error
  variableList?: CatCatchHlsVariableList
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#EXT-X-DEFINE and parseLevelPlaylist(variableList)
 * Reason: HLS variable references are ordered, single-pass substitutions; media
 * playlists may only see master variables named by an explicit IMPORT tag.
 * Adaptation: the synchronous facade throws hls.js's first playlist parsing error.
 * Fixture: hls-variable-substitution
 */
const HLS_VARIABLE_REFERENCE_PATTERN = /\{\$([a-zA-Z0-9-_]+)\}/g
const HLS_HEXADECIMAL_ATTRIBUTES = new Set([
  'IV',
  'SCTE35-CMD',
  'SCTE35-IN',
  'SCTE35-OUT',
])

// hls.js 1.6.16 src/utils/codecs.ts#sampleEntryCodesISO. Keep this list
// pinned to the vendored parser instead of consulting runtime MediaSource:
// Cat Catch first removes mixed-in unknown codec levels at parse time, while
// browser codec support is a later, environment-specific decision.
const HLS_KNOWN_CODEC_PREFIXES = new Set([
  'a3ds', 'ac-3', 'ac-4', 'alac', 'alaw', 'dra1', 'dts+', 'dts-',
  'dtsc', 'dtse', 'dtsh', 'ec-3', 'enca', 'fLaC', 'flac', 'FLAC',
  'g719', 'g726', 'm4ae', 'mha1', 'mha2', 'mhm1', 'mhm2', 'mlpa',
  'mp4a', 'raw ', 'Opus', 'opus', 'samr', 'sawb', 'sawp', 'sevc',
  'sqcp', 'ssmv', 'twos', 'ulaw',
  'avc1', 'avc2', 'avc3', 'avc4', 'avcp', 'av01', 'dav1', 'drac',
  'dva1', 'dvav', 'dvh1', 'dvhe', 'encv', 'hev1', 'hvc1', 'mjp2',
  'mp4v', 'mvc1', 'mvc2', 'mvc3', 'mvc4', 'resv', 'rv60', 's263',
  'svc1', 'svc2', 'vc-1', 'vp08', 'vp09',
  'stpp', 'wvtt',
])

const HLS_FULL_SEGMENT_ENCRYPTION_METHODS = new Set([
  'AES-128',
  'AES-256',
  'AES-256-CTR',
])

// hls.js 1.6.16 src/utils/mediakeys-helper.ts#KeySystemFormats.
// Cat Catch vendors the full EME build, so these KEYFORMAT values remain
// supported even though OmniFlow does not perform browser-side DRM playback.
const HLS_EME_KEY_FORMATS = new Set([
  'com.apple.streamingkeydelivery',
  'org.w3.clearkey',
  'com.microsoft.playready',
  'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
])

const HLS_EME_ENCRYPTION_METHODS = new Set([
  'SAMPLE-AES',
  'SAMPLE-AES-CENC',
  'SAMPLE-AES-CTR',
])

function parseNumber(value?: string) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseInteger(value?: string) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseHlsUnsignedIntegerTag(line: string, tag: string) {
  const prefix = `#EXT-X-${tag}:`
  if (!line.startsWith(prefix)) return undefined
  const match = /^ *(\d+)/.exec(line.slice(prefix.length))
  return match ? Number.parseInt(match[1], 10) : undefined
}

function parseBoolean(value?: string) {
  return value === 'YES'
}

function rememberVariableParsingError(state: HlsVariableState, message: string) {
  state.playlistParsingError ||= new Error(message)
}

function assignPlaylistParsingError(state: HlsVariableState, message: string) {
  state.playlistParsingError = new Error(message)
}

function assignMultipleMediaPlaylistTagError(
  state: HlsVariableState,
  tag: string,
  line: string,
) {
  assignPlaylistParsingError(
    state,
    `#EXT-X-${tag} must not appear more than once (${line})`,
  )
}

function assignTagMustPrecedeSegmentsError(
  state: HlsVariableState,
  tag: string,
  line: string,
) {
  assignPlaylistParsingError(
    state,
    `#EXT-X-${tag} must appear before the first Media Segment (${line})`,
  )
}

function substituteHlsVariables(input: string, state: HlsVariableState) {
  return input.replace(HLS_VARIABLE_REFERENCE_PATTERN, (reference, variableName: string) => {
    const value = state.variableList?.[variableName]
    if (value === undefined) {
      rememberVariableParsingError(
        state,
        `Missing preceding EXT-X-DEFINE tag for Variable Reference: "${variableName}"`,
      )
      return reference
    }
    return value
  })
}

function parseHlsAttributeListWithVariables(
  input: string,
  variableState?: HlsVariableState,
): CatCatchHlsAttributeMap {
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
    const quoted = normalizedValue.startsWith('"') && normalizedValue.endsWith('"')
    if (quoted) {
      normalizedValue = normalizedValue.slice(1, -1)
    }
    if (variableState && (quoted || HLS_HEXADECIMAL_ATTRIBUTES.has(normalizedKey))) {
      normalizedValue = substituteHlsVariables(normalizedValue, variableState)
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

export function parseHlsAttributeList(input: string): CatCatchHlsAttributeMap {
  return parseHlsAttributeListWithVariables(input)
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#BaseSegment.setByteRange
 * Reason: hls.js parses range length and offset with radix-inferred parseInt,
 * accepting valid integer prefixes that strict Number conversion would drop.
 * Adaptation: non-positive or non-finite ranges are rejected by the manifest
 * facade instead of becoming Cat Catch's invalid Range header or a full fetch.
 * Fixture: hls-byterange-numeric-normalization
 */
export function parseHlsByteRange(input?: string): CatCatchHlsByteRange | undefined {
  const normalizedInput = String(input || '').trim()
  if (!normalizedInput) return undefined
  const [lengthText, offsetText] = normalizedInput.split('@', 2)
  const length = Number.parseInt(lengthText)
  if (!Number.isFinite(length) || length <= 0) return undefined
  const offset = offsetText === undefined ? undefined : Number.parseInt(offsetText)
  if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) return undefined
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

// The pinned media-playlist slow regex uses (.+) for valued tag payloads.
function hasHlsValuedTagPayload(line: string) {
  const colonIndex = line.indexOf(':')
  return colonIndex >= 0 && colonIndex < line.length - 1
}

function parseExtinf(line: string, currentSegment?: PendingSegment): ParsedExtinf {
  const value = getTagValue(line)
  const durationText = /^(\d*(?:\.\d+)?)/.exec(value)?.[1] || ''
  const remainder = value.slice(durationText.length)
  const hasTitle = remainder.startsWith(',')
  const title = hasTitle && durationText
    ? remainder.slice(1).trim() || undefined
    : undefined
  const inlineUri = hasTitle
    ? undefined
    : remainder.trimStart()

  return {
    // The fixed fast regex leaves a non-decimal remainder to its URI
    // alternative. Cat Catch then downloads that remainder as a fragment.
    inlineUri: inlineUri && !inlineUri.startsWith('#') ? inlineUri : undefined,
    segment: durationText
      ? { duration: Number.parseFloat(durationText), title }
      : currentSegment || { duration: 0 },
  }
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#AttrList.hexadecimalInteger and parseKey
 * Reason: hls.js treats IV as bytes rather than preserving attribute text. It
 * left-pads odd input and lets Uint8Array coerce invalid parseInt results to 0.
 * Adaptation: serialize the same bytes back into the existing hexadecimal DTO.
 * Fixture: hls-key-iv-normalization
 */
function normalizeHlsIvBytes(value?: string) {
  if (!value) return undefined
  let byteText = value.slice(2)
  byteText = `${byteText.length & 1 ? '0' : ''}${byteText}`
  const bytes = new Uint8Array(byteText.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(byteText.slice(index * 2, index * 2 + 2), 16)
  }
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function createHlsKey(
  line: string,
  baseUrl: string,
  variableState: HlsVariableState,
): CatCatchHlsKey {
  const attributes = parseHlsAttributeListWithVariables(getTagValue(line), variableState)
  const uri = attributes.URI
  return {
    iv: normalizeHlsIvBytes(attributes.IV),
    keyFormat: attributes.KEYFORMAT,
    keyFormatVersions: attributes.KEYFORMATVERSIONS,
    method: attributes.METHOD || '',
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : undefined,
  }
}

function createHlsMap(
  line: string,
  baseUrl: string,
  variableState: HlsVariableState,
  leadingByteRange?: CatCatchHlsByteRange,
): CatCatchHlsMap | null {
  const attributes = parseHlsAttributeListWithVariables(getTagValue(line), variableState)
  const uri = String(attributes.URI || '').trim()
  if (!uri) return null
  const url = resolveHlsUrl(uri, baseUrl)
  const rawByteRange = attributes.BYTERANGE
  const parsedByteRange = rawByteRange
    ? parseHlsByteRange(rawByteRange)
    : undefined
  if (rawByteRange && !parsedByteRange) {
    rememberVariableParsingError(variableState, 'Invalid HLS BYTERANGE')
  }
  const byteRange = rawByteRange
    ? parsedByteRange
    : leadingByteRange
  return {
    byteRange: resolveByteRange(byteRange),
    rawAttributes: attributes,
    rawLine: line,
    uri,
    url,
  }
}

function createHlsVariant(
  line: string,
  uri: string | undefined,
  baseUrl: string,
  variableState: HlsVariableState,
): CatCatchHlsVariant | null {
  const attributes = parseHlsAttributeListWithVariables(getTagValue(line), variableState)
  const substitutedUri = uri === undefined
    ? attributes.URI
    : substituteHlsVariables(uri, variableState)
  if (!substitutedUri) return null
  return {
    audioGroupId: attributes.AUDIO,
    audioGroupIds: attributes.AUDIO ? [attributes.AUDIO] : undefined,
    averageBandwidth: parseNumber(attributes['AVERAGE-BANDWIDTH']),
    bandwidth: parseNumber(attributes.BANDWIDTH),
    codecs: attributes.CODECS,
    frameRate: parseNumber(attributes['FRAME-RATE']),
    rawAttributes: attributes,
    rawLine: line,
    resolution: attributes.RESOLUTION,
    subtitlesGroupId: attributes.SUBTITLES,
    subtitlesGroupIds: attributes.SUBTITLES ? [attributes.SUBTITLES] : undefined,
    uri: substitutedUri,
    url: resolveHlsUrl(substitutedUri, baseUrl),
  }
}

function getHlsVariantIdentity(variant: CatCatchHlsVariant) {
  const attributes = variant.rawAttributes
  return [
    attributes['PATHWAY-ID'] || '.',
    variant.bandwidth,
    attributes.RESOLUTION,
    attributes['FRAME-RATE'],
    attributes.CODECS,
    attributes['VIDEO-RANGE'],
    attributes['HDCP-LEVEL'],
  ].map(value => String(value)).join('-')
}

function appendUniqueHlsGroupIds(target: string[] | undefined, source: string[] | undefined) {
  if (!source?.length) return target
  const result = target || []
  source.forEach((groupId) => {
    if (!result.includes(groupId)) result.push(groupId)
  })
  return result
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#Level.addGroupId and LevelController.onManifestLoaded
 * Reason: repeated EXT-X-STREAM-INF entries can describe one selectable level
 * while attaching different AUDIO/SUBTITLES groups. Exposing each declaration
 * as a variant duplicates the quality choice and hides valid renditions.
 * Adaptation: the pinned MANIFEST_PARSED event exposes only the first URI for
 * cross-URI pathway entries. OmniFlow keeps each unique URI selectable to avoid
 * data loss, while merging all matching identity/URI declarations regardless
 * of their position. This does not add ordered fallback or failover semantics.
 * Fixtures: hls-master-variant-group-merge, hls-master-pathway-uri-boundary
 */
function mergeHlsVariantGroups(variants: CatCatchHlsVariant[]) {
  const variantsByIdentity = new Map<string, Map<string, CatCatchHlsVariant>>()
  const mergedVariants: CatCatchHlsVariant[] = []
  variants.forEach((variant) => {
    const identity = getHlsVariantIdentity(variant)
    let variantsByUrl = variantsByIdentity.get(identity)
    if (!variantsByUrl) {
      variantsByUrl = new Map<string, CatCatchHlsVariant>()
      variantsByIdentity.set(identity, variantsByUrl)
    }
    const existing = variantsByUrl.get(variant.url)
    if (!existing) {
      variantsByUrl.set(variant.url, variant)
      mergedVariants.push(variant)
      return
    }
    existing.audioGroupIds = appendUniqueHlsGroupIds(
      existing.audioGroupIds,
      variant.audioGroupIds,
    )
    existing.audioGroupId ||= existing.audioGroupIds?.[0]
    existing.subtitlesGroupIds = appendUniqueHlsGroupIds(
      existing.subtitlesGroupIds,
      variant.subtitlesGroupIds,
    )
    existing.subtitlesGroupId ||= existing.subtitlesGroupIds?.[0]
  })
  return mergedVariants
}

function hasOnlyKnownHlsCodecs(variant: CatCatchHlsVariant) {
  const codecs = String(variant.codecs || '').split(/[ ,]+/).filter(Boolean)
  return codecs.every(codec => HLS_KNOWN_CODEC_PREFIXES.has(codec.slice(0, 4)))
}

function createHlsRendition(
  line: string,
  baseUrl: string,
  variableState: HlsVariableState,
): CatCatchHlsRendition | null {
  const attributes = parseHlsAttributeListWithVariables(getTagValue(line), variableState)
  const type = attributes.TYPE
  if (type !== 'AUDIO' && type !== 'SUBTITLES') return null
  const uri = attributes.URI
  const language = attributes.LANGUAGE
  return {
    autoselect: parseBoolean(attributes.AUTOSELECT) || false,
    default: parseBoolean(attributes.DEFAULT) || false,
    forced: parseBoolean(attributes.FORCED) || false,
    groupId: attributes['GROUP-ID'] || '',
    language,
    name: attributes.NAME || language || '',
    rawAttributes: attributes,
    rawLine: line,
    type,
    uri,
    url: uri ? resolveHlsUrl(uri, baseUrl) : '',
  }
}

function parseHlsVariableDefinition(line: string, state: HlsVariableState) {
  const attributes = parseHlsAttributeListWithVariables(getTagValue(line), state)
  if ('IMPORT' in attributes) {
    const variableName = attributes.IMPORT
    if (state.parentVariableList && variableName in state.parentVariableList) {
      state.variableList ||= {}
      state.variableList[variableName] = state.parentVariableList[variableName]
      return
    }
    rememberVariableParsingError(
      state,
      `EXT-X-DEFINE IMPORT attribute not found in Multivariant Playlist: "${variableName}"`,
    )
    return
  }

  let variableName = attributes.NAME
  let variableValue = attributes.VALUE
  if ('QUERYPARAM' in attributes) {
    variableName = attributes.QUERYPARAM
    try {
      const searchParams = new URL(state.baseUrl).searchParams
      if (!searchParams.has(variableName)) {
        throw new Error(`"${variableName}" does not match any query parameter in URI: "${state.baseUrl}"`)
      }
      variableValue = searchParams.get(variableName) || ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      rememberVariableParsingError(state, `EXT-X-DEFINE QUERYPARAM: ${message}`)
    }
  }

  const normalizedVariableName = String(variableName)
  state.variableList ||= {}
  if (normalizedVariableName in state.variableList) {
    rememberVariableParsingError(
      state,
      `EXT-X-DEFINE duplicate Variable Name declarations: "${normalizedVariableName}"`,
    )
    return
  }
  state.variableList[normalizedVariableName] = variableValue || ''
}

function resolveByteRange(
  byteRange: CatCatchHlsByteRange | undefined,
  previousEnd?: number,
) {
  if (!byteRange) return undefined
  const offset = byteRange.offset ?? previousEnd ?? 0
  return { ...byteRange, offset }
}

function createHlsDefaultIvHex(sequence: number) {
  return `0x${Array.from(createHlsDefaultIv(sequence), byte => (
    byte.toString(16).padStart(2, '0')
  )).join('')}`
}

function getHlsKeyFormat(key: CatCatchHlsKey) {
  return key.keyFormat || 'identity'
}

function isSupportedHlsKey(key: CatCatchHlsKey) {
  const method = key.method
  if (HLS_FULL_SEGMENT_ENCRYPTION_METHODS.has(method) || method === 'NONE') {
    return true
  }
  const keyFormat = getHlsKeyFormat(key)
  if (keyFormat === 'identity') return method === 'SAMPLE-AES'
  return HLS_EME_KEY_FORMATS.has(keyFormat)
    && HLS_EME_ENCRYPTION_METHODS.has(method)
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#LevelKey.getDecryptData and createInitializationVector
 * Reason: every full-segment encrypted media fragment without an explicit IV
 * uses its media sequence, while hls.js resolves an EXT-X-MAP init segment
 * with sequence zero. Non-identity full-segment keys normalize to identity.
 * Adaptation: expose the effective IV as the existing hexadecimal DTO string.
 * Fixtures: hls-aes128-iv-semantics, hls-encrypted-map-key-context
 */
function resolveHlsKeyForSequence(
  key: CatCatchHlsKey | undefined,
  sequence: number,
) {
  if (!key?.url) return undefined
  if (!HLS_FULL_SEGMENT_ENCRYPTION_METHODS.has(key.method)) return key
  const normalizedKey = getHlsKeyFormat(key) === 'identity'
    ? key
    : { ...key, keyFormat: undefined }
  if (normalizedKey.iv) return normalizedKey
  return {
    ...normalizedKey,
    iv: createHlsDefaultIvHex(sequence),
  }
}

function selectHlsKeyForSequence(
  keys: ReadonlyMap<string, CatCatchHlsKey> | undefined,
  sequence: number,
) {
  if (!keys) return undefined
  const key = keys.get('identity') || (keys.size === 1
    ? keys.values().next().value
    : undefined)
  return resolveHlsKeyForSequence(key, sequence)
}

function normalizeHlsKeyFormatVersions(value?: string) {
  return (value || '1')
    .split('/')
    .map(Number)
    .filter(Number.isFinite)
    .join('/')
}

function hlsKeysMatch(left: CatCatchHlsKey, right: CatCatchHlsKey) {
  return left.url === right.url
    && left.method === right.method
    && getHlsKeyFormat(left) === getHlsKeyFormat(right)
    && normalizeHlsKeyFormatVersions(left.keyFormatVersions)
      === normalizeHlsKeyFormatVersions(right.keyFormatVersions)
    && left.iv?.toLowerCase() === right.iv?.toLowerCase()
    && left.rawAttributes.KEYID?.toLowerCase()
      === right.rawAttributes.KEYID?.toLowerCase()
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: lib/hls.min.js#M3U8Parser.isMediaPlaylist, parseMasterPlaylist,
 * parseLevelPlaylist, and handlePlaylistLoaded
 * Reason: playlist parsing errors prevent Cat Catch's LEVEL_LOADED -> parseTs
 * path, so malformed input must not become an executable OmniFlow plan.
 * Fixture: hls-media-playlist-structure-errors
 */
export function parseHlsManifest(input: {
  baseUrl: string
  parentVariableList?: Readonly<CatCatchHlsVariableList>
  text: string
}): CatCatchHlsManifest {
  const baseUrl = String(input.baseUrl || '').trim()
  const text = String(input.text || '').replace(/^\uFEFF/, '')
  const hasMediaPlaylistSyntax = /^#EXT(?:INF|-X-TARGETDURATION):/m.test(text)
  const variableState: HlsVariableState = {
    baseUrl,
    parentVariableList: input.parentVariableList,
  }
  const lines = text
    // The pinned fast parser treats CR, LF, and CRLF as line boundaries.
    .split(/\r\n|\n|\r/)
    // The pinned (.+) valued-tag branch treats trailing whitespace as payload.
    .map(line => line.trimStart())
    .filter(Boolean)

  if (lines[0] !== '#EXTM3U') {
    throw new Error(hasMediaPlaylistSyntax
      ? 'Missing format identifier #EXTM3U'
      : 'no EXTM3U delimiter')
  }

  let mediaSequence = 0
  let targetDuration: number | undefined
  let playlistVersion: number | undefined
  let playlistType: string | undefined
  let playlistTypeSeen = false
  let hasEndList = false
  let initialDiscontinuitySequence = 0
  let discontinuitySequence = 0
  let serverControlSeen = false
  let partTarget = 0
  let skippedSegmentCount = 0
  let currentKeys: Map<string, CatCatchHlsKey> | undefined
  let currentMap: CatCatchHlsMap | undefined
  let pendingSegment: PendingSegment | undefined
  let pendingByteRange: CatCatchHlsByteRange | undefined
  let pendingVariantLine: string | undefined
  let previousSegmentByteRangeEnd: number | undefined

  const keys = new Map<string, CatCatchHlsKey>()
  const maps = new Map<string, CatCatchHlsMap>()
  const declaredMaps: CatCatchHlsMap[] = []
  const mapKeyStates = new WeakMap<CatCatchHlsMap, ReadonlyMap<string, CatCatchHlsKey>>()
  const segments: CatCatchHlsSegment[] = []
  const segmentKeyStates: Array<ReadonlyMap<string, CatCatchHlsKey> | undefined> = []
  const variants: CatCatchHlsVariant[] = []
  const renditions: CatCatchHlsRendition[] = []
  const masterMediaLines: string[] = []

  function rememberKey(key: CatCatchHlsKey | undefined) {
    if (!key?.url && !key?.uri) return
    const keyId = `${key.method}:${key.url || key.uri}:${getHlsKeyFormat(key)}`
    if (!keys.has(keyId)) keys.set(keyId, key)
  }

  function rememberMap(map: CatCatchHlsMap) {
    rememberKey(map.key)
    maps.set([
      map.url,
      map.byteRange?.raw || '',
      map.byteRange?.offset ?? '',
      map.key?.method || '',
      map.key?.url || '',
      map.key?.iv || '',
    ].join(':'), map)
  }

  function addSegment(uri: string, part: boolean, byteRange = pendingByteRange) {
    const normalizedUri = substituteHlsVariables(String(uri || '').trim(), variableState)
    if (!normalizedUri) return
    // hls.js retains this fragment until a later valid EXTINF resets duration.
    if (pendingSegment && !Number.isFinite(pendingSegment.duration)) return
    const url = resolveHlsUrl(normalizedUri, baseUrl)
    const index = segments.length
    const sequence = mediaSequence + index
    const resolvedByteRange = resolveByteRange(byteRange, previousSegmentByteRangeEnd)
    segments.push({
      byteRange: resolvedByteRange,
      discontinuitySequence,
      duration: pendingSegment?.duration || 0,
      encrypted: Boolean(currentKeys?.size),
      index,
      map: currentMap,
      part,
      sequence,
      title: pendingSegment?.title,
      uri: normalizedUri,
      url,
    })
    segmentKeyStates.push(currentKeys)
    previousSegmentByteRangeEnd = resolvedByteRange
      ? resolvedByteRange.offset + resolvedByteRange.length
      : undefined
    pendingSegment = undefined
    pendingByteRange = undefined
  }

  for (const line of lines) {
    if (pendingVariantLine && !line.startsWith('#')) {
      const variant = createHlsVariant(pendingVariantLine, line, baseUrl, variableState)
      if (variant) variants.push(variant)
      pendingVariantLine = undefined
      continue
    }
    if (pendingVariantLine && line.startsWith('#')) {
      // MASTER_PLAYLIST_REGEX consumes intervening comments as part of the
      // pending STREAM-INF match. MEDIA is still collected by its second pass.
      if (line.startsWith('#EXT-X-MEDIA:')) {
        masterMediaLines.push(line)
      }
      continue
    }
    if (!line.startsWith('#')) {
      if (hasMediaPlaylistSyntax) addSegment(line, false)
      continue
    }
    if (line.startsWith('#EXT-X-DEFINE:')) {
      if (hasMediaPlaylistSyntax && !hasHlsValuedTagPayload(line)) continue
      parseHlsVariableDefinition(line, variableState)
      continue
    }
    if (!hasMediaPlaylistSyntax && line.startsWith('#EXT-X-SESSION-KEY:')) {
      // Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
      // Source: lib/hls.min.js#parseMasterPlaylist/EmeController.onManifestLoaded
      // Cat Catch leaves emeEnabled=false and never consumes sessionKeys in its
      // download handlers. Parse attributes for ordered variable errors only;
      // SESSION-KEY must not enter the fragment key state.
      parseHlsAttributeListWithVariables(getTagValue(line), variableState)
      continue
    }
    // Pinned hls.js requires a colon immediately after valued tag names. Its
    // no-value tag regex has different prefix behavior, preserved below.
    if (!hasMediaPlaylistSyntax && line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingVariantLine = line
      continue
    }
    if (!hasMediaPlaylistSyntax && line.startsWith('#EXT-X-MEDIA:')) {
      masterMediaLines.push(line)
      continue
    }
    if (!hasMediaPlaylistSyntax) continue
    const parsedMediaSequence = parseHlsUnsignedIntegerTag(line, 'MEDIA-SEQUENCE')
    if (parsedMediaSequence !== undefined) {
      if (mediaSequence !== 0) {
        assignMultipleMediaPlaylistTagError(variableState, 'MEDIA-SEQUENCE', line)
      } else if (segments.length > 0) {
        assignTagMustPrecedeSegmentsError(variableState, 'MEDIA-SEQUENCE', line)
      }
      mediaSequence = parsedMediaSequence
      continue
    }
    const parsedTargetDuration = parseHlsUnsignedIntegerTag(line, 'TARGETDURATION')
    if (parsedTargetDuration !== undefined) {
      if (targetDuration !== undefined) {
        assignMultipleMediaPlaylistTagError(variableState, 'TARGETDURATION', line)
      }
      targetDuration = Math.max(parsedTargetDuration, 1)
      continue
    }
    const parsedVersion = parseHlsUnsignedIntegerTag(line, 'VERSION')
    if (parsedVersion !== undefined) {
      if (playlistVersion !== undefined) {
        assignMultipleMediaPlaylistTagError(variableState, 'VERSION', line)
      }
      playlistVersion = parsedVersion
      continue
    }
    if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      if (playlistTypeSeen) {
        assignMultipleMediaPlaylistTagError(variableState, 'PLAYLIST-TYPE', line)
      }
      playlistTypeSeen = true
      playlistType = getTagValue(line).toUpperCase() || undefined
      continue
    }
    if (line.startsWith('#EXT-X-SKIP:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      if (skippedSegmentCount !== 0) {
        assignMultipleMediaPlaylistTagError(variableState, 'SKIP', line)
      }
      const attributes = parseHlsAttributeListWithVariables(getTagValue(line), variableState)
      const parsedSkippedSegmentCount = parseInteger(attributes['SKIPPED-SEGMENTS'])
      if (parsedSkippedSegmentCount !== undefined) {
        skippedSegmentCount += parsedSkippedSegmentCount
      }
      continue
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      const key = createHlsKey(line, baseUrl, variableState)
      if (!isSupportedHlsKey(key)) continue
      if (key.method === 'NONE') {
        currentKeys = undefined
      } else {
        currentKeys ||= new Map()
        const keyFormat = getHlsKeyFormat(key)
        const currentKey = currentKeys.get(keyFormat)
        if (currentKey && hlsKeysMatch(currentKey, key)) continue
        // hls.js shares different KEYFORMAT alternatives with earlier
        // fragments, but copies the group before a same-format rotation.
        if (currentKey) currentKeys = new Map(currentKeys)
        currentKeys.set(keyFormat, key)
      }
      continue
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      // Pinned hls.js reuses a preceding EXT-X-BYTERANGE for the MAP only
      // while no positive EXTINF is pending. It also carries that same range
      // into the next media fragment, so pendingByteRange remains intact.
      const map = createHlsMap(
        line,
        baseUrl,
        variableState,
        pendingSegment?.duration
          ? undefined
          : resolveByteRange(pendingByteRange, previousSegmentByteRangeEnd),
      )
      if (map) {
        currentMap = map
        declaredMaps.push(map)
        if (currentKeys) mapKeyStates.set(map, currentKeys)
      } else {
        // Pinned hls.js replaces the current init segment with url="" and
        // Cat Catch later fetches that URL relative to its extension page.
        // Reject before plan creation instead of retaining the previous MAP
        // or fetching unrelated page content as initialization bytes.
        variableState.playlistParsingError ||= new Error(
          'EXT-X-MAP URI must be a non-empty string',
        )
        currentMap = undefined
      }
      continue
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      const rawByteRange = getTagValue(line)
      pendingByteRange = parseHlsByteRange(rawByteRange)
      if (!pendingByteRange) {
        rememberVariableParsingError(variableState, 'Invalid HLS BYTERANGE')
      }
      continue
    }
    const parsedDiscontinuitySequence = parseHlsUnsignedIntegerTag(
      line,
      'DISCONTINUITY-SEQUENCE',
    )
    if (parsedDiscontinuitySequence !== undefined) {
      if (initialDiscontinuitySequence !== 0) {
        assignMultipleMediaPlaylistTagError(variableState, 'DISCONTINUITY-SEQUENCE', line)
      } else if (segments.length > 0) {
        assignTagMustPrecedeSegmentsError(variableState, 'DISCONTINUITY-SEQUENCE', line)
      }
      initialDiscontinuitySequence = discontinuitySequence = parsedDiscontinuitySequence
      continue
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuitySequence += 1
      continue
    }
    if (line.startsWith('#EXTINF:')) {
      const parsedExtinf = parseExtinf(line, pendingSegment)
      pendingSegment = parsedExtinf.segment
      if (parsedExtinf.inlineUri) addSegment(parsedExtinf.inlineUri, false)
      continue
    }
    if (line.startsWith('#EXT-X-PART-INF:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      if (partTarget) {
        assignMultipleMediaPlaylistTagError(variableState, 'PART-INF', line)
      }
      const attributes = parseHlsAttributeList(getTagValue(line))
      partTarget = Number.parseFloat(attributes['PART-TARGET'] || '')
      continue
    }
    if (line.startsWith('#EXT-X-PART')) {
      // Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
      // Source: lib/hls.min.js#partList; js/m3u8.js#parseTs(data)
      // Pinned hls.js keeps LL-HLS parts outside LevelDetails.fragments, while
      // Cat Catch's parseTs copies only fragments into its downloader.
      // Treating parts as fragments duplicates them once EXTINF is published.
      continue
    }
    if (line.startsWith('#EXT-X-SERVER-CONTROL:')) {
      if (!hasHlsValuedTagPayload(line)) continue
      if (serverControlSeen) {
        assignMultipleMediaPlaylistTagError(variableState, 'SERVER-CONTROL', line)
      }
      serverControlSeen = true
      continue
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      if (hasEndList) {
        assignMultipleMediaPlaylistTagError(variableState, 'ENDLIST', line)
      }
      hasEndList = true
    }
  }

  masterMediaLines.forEach((line) => {
    const rendition = createHlsRendition(line, baseUrl, variableState)
    if (rendition) renditions.push(rendition)
  })

  if (hasMediaPlaylistSyntax && targetDuration === undefined) {
    assignPlaylistParsingError(variableState, 'Missing Target Duration')
  }
  if (variableState.playlistParsingError) {
    throw variableState.playlistParsingError
  }
  if (skippedSegmentCount > 0) {
    // Pinned hls.js exposes null placeholders to Cat Catch's external
    // LEVEL_LOADED listener before its internal delta merge. parseTs then
    // dereferences fragment.url, so this path never yields a download plan.
    throw new Error('HLS delta playlist cannot enter the Cat Catch download path')
  }

  segments.forEach((segment, index) => {
    segment.key = selectHlsKeyForSequence(segmentKeyStates[index], segment.sequence)
    rememberKey(segment.key)
  })
  declaredMaps.forEach((map) => {
    map.key = selectHlsKeyForSequence(mapKeyStates.get(map), 0)
    rememberMap(map)
  })

  /**
   * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
   * Source: lib/hls.min.js#parseMasterPlaylist; js/m3u8.js#MANIFEST_PARSED
   * Reason: Cat Catch's selectable data.levels excludes I-frame streams and,
   * when at least one normal level has only recognized codecs, drops normal
   * levels containing unknown codec identifiers.
   * Adaptation: retain every normal level when all codec sets are unknown so
   * the parser boundary stays independent from runtime MediaSource support.
   * Fixture: hls-master-variant-filtering
   */
  const variantsWithKnownCodecs = variants.filter(hasOnlyKnownHlsCodecs)
  const selectableVariants = variantsWithKnownCodecs.length > 0
    ? variantsWithKnownCodecs
    : variants
  variants.splice(0, variants.length, ...mergeHlsVariantGroups(selectableVariants))
  if (!variants.length && !segments.length) {
    // Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
    // Source: lib/hls.min.js#parseMasterPlaylist/handlePlaylistLoaded
    // Cat Catch rejects a master with no normal levels and never reaches
    // parseTs for media with no complete fragment. I-frame-only masters and
    // PART-only live snapshots therefore cannot become executable plans.
    throw new Error(hasMediaPlaylistSyntax
      ? 'No Segments found in Playlist'
      : 'no levels found in manifest')
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
    variableList: variableState.variableList,
    variants,
  }
}
