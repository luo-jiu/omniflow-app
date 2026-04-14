import type {
  EmbeddedBrowserCapturedRequestHeaders,
  EmbeddedBrowserCapturedResourceKind,
  EmbeddedBrowserCapturedStreamType,
} from './embeddedBrowserResourceTypes'

const manifestExtensions = new Set(['m3u8', 'm3u', 'mpd'])
const mediaExtensions = new Set([
  'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'ogv',
  'webm', 'mkv', 'mov', 'avi', 'ts', 'flv', 'hlv', 'f4v', 'wma', 'mpeg', 'wmv',
  'asf', 'movie', 'divx', 'mpeg4', 'vid', 'weba', 'opus', 'acc', '3gp',
])
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])
const subtitleExtensions = new Set(['vtt', 'srt', 'ass', 'ssa', 'ttml'])
const keyExtensions = new Set(['key', 'base64key'])
const relevantRequestHeaders = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'range',
  'referer',
  'user-agent',
])

export function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
) {
  if (!headers) {
    return ''
  }
  const targetName = name.toLowerCase()
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== targetName) {
      continue
    }
    if (Array.isArray(headerValue)) {
      return String(headerValue[0] || '')
    }
    return String(headerValue || '')
  }
  return ''
}

export function normalizeMimeType(input?: string | null) {
  return String(input || '').split(';')[0]?.trim().toLowerCase() || ''
}

export function getResourceExtension(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const match = pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1] || ''
  } catch {
    const match = String(url || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i)
    return match?.[1] || ''
  }
}

export function classifyCapturedResource(input: {
  mimeType?: string
  resourceType?: string
  url: string
}): EmbeddedBrowserCapturedResourceKind {
  const normalizedMimeType = normalizeMimeType(input.mimeType)
  const extension = getResourceExtension(input.url)
  if (
    manifestExtensions.has(extension)
    || normalizedMimeType.includes('mpegurl')
    || normalizedMimeType.includes('dash+xml')
  ) {
    return 'manifest'
  }
  if (
    mediaExtensions.has(extension)
    || normalizedMimeType.startsWith('video/')
    || normalizedMimeType.startsWith('audio/')
    || normalizedMimeType === 'application/ogg'
    || normalizedMimeType === 'application/m4s'
    || input.resourceType === 'media'
    || String(input.url || '').startsWith('blob:')
  ) {
    return 'media'
  }
  if (imageExtensions.has(extension) || normalizedMimeType.startsWith('image/')) {
    return 'image'
  }
  if (subtitleExtensions.has(extension) || normalizedMimeType.includes('text/vtt')) {
    return 'subtitle'
  }
  if (extension === 'pdf' || normalizedMimeType === 'application/pdf') {
    return 'document'
  }
  if (
    keyExtensions.has(extension)
    || input.resourceType === 'key'
    || normalizedMimeType === 'application/octet-stream'
  ) {
    return 'key'
  }
  return 'other'
}

export function shouldCaptureResource(input: {
  kind: EmbeddedBrowserCapturedResourceKind
  resourceType?: string
  url: string
}) {
  if (!input.url || input.url.startsWith('data:')) {
    return false
  }
  if (input.kind !== 'other') {
    return true
  }
  return input.resourceType === 'media' || input.url.startsWith('blob:')
}

export function parseContentLength(rawValue: string) {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function parseContentRangeTotal(rawValue: string) {
  const value = String(rawValue || '').trim()
  if (!value) {
    return undefined
  }
  const match = value.match(/\/(\d+)\s*$/)
  if (!match?.[1]) {
    return undefined
  }
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function inferStreamType(input: {
  mimeType?: string
  resourceType?: string
  streamType?: EmbeddedBrowserCapturedStreamType
  url?: string
}) {
  if (input.streamType) {
    return input.streamType
  }
  const normalizedMimeType = normalizeMimeType(input.mimeType)
  if (normalizedMimeType.startsWith('audio/')) {
    return 'audio' as const
  }
  if (normalizedMimeType.startsWith('video/')) {
    return 'video' as const
  }
  const normalizedUrl = String(input.url || '').toLowerCase()
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(normalizedUrl)) {
    return 'audio' as const
  }
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(normalizedUrl)) {
    return 'video' as const
  }
  if (input.resourceType === 'media') {
    return 'video' as const
  }
  return undefined
}

export function pickRelevantRequestHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
) {
  if (!headers) {
    return undefined
  }
  const result: EmbeddedBrowserCapturedRequestHeaders = {}
  Object.entries(headers).forEach(([headerName, headerValue]) => {
    const normalizedName = headerName.toLowerCase()
    if (!relevantRequestHeaders.has(normalizedName)) {
      return
    }
    const normalizedValue = String(headerValue || '').trim()
    if (!normalizedValue) {
      return
    }
    result[normalizedName] = normalizedValue
  })
  return Object.keys(result).length ? result : undefined
}
