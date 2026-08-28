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
  encrypted: boolean
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
  keys: EmbeddedBrowserHlsDownloadKeyRef[]
  manifestUrl: string
  mapTag: string
  maps: EmbeddedBrowserHlsDownloadMapRef[]
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
