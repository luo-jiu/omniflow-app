import type { CapturedResourceKind } from '../../contracts/captured-resource'
import {
  classifyResource,
  type NetworkResourceClassification,
  type NetworkResourceInput,
} from '../../cat-catch-port/network/classifier'
import {
  CAT_CATCH_DEFAULT_EXTENSION_RULES,
  type CatCatchCompiledRules,
} from '../../cat-catch-port/network/rules'

export type OmniFlowProductResourceKind = 'document' | 'image' | 'key' | 'subtitle'

export type OmniFlowNetworkResourceClassification = Omit<
  NetworkResourceClassification,
  'kind' | 'reason'
> & {
  kind?: CapturedResourceKind
  reason: NetworkResourceClassification['reason']
    | 'omniflow-document'
    | 'omniflow-image'
    | 'omniflow-key'
    | 'omniflow-subtitle'
}

export type OmniFlowResourceSignalInput = {
  declaredKind?: string
  extension?: string
  mimeType?: string
  resourceType?: string
  url: string
}

const imageExtensions = new Set([
  'avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp',
])
const subtitleExtensions = new Set([
  'ass', 'dfxp', 'idx', 'krc', 'ksc', 'lrc', 'lyric', 'lyrics', 'qrc', 'sami',
  'sbv', 'scc', 'smi', 'srt', 'ssa', 'stl', 'sub', 'sup', 'trc', 'ttml', 'vtt',
  'webvtt', 'yrc',
])
const keyExtensions = new Set(['base64key', 'key'])
const manifestExtensions = new Set(['m3u', 'm3u8', 'mpd'])
const mediaExtensions = new Set(
  CAT_CATCH_DEFAULT_EXTENSION_RULES
    .map(rule => rule.ext)
    .filter(extension => (
      !manifestExtensions.has(extension)
      && !subtitleExtensions.has(extension)
    )),
)
const manifestMimeTypes = new Set([
  'application/dash+xml',
  'application/mpegurl',
  'application/octet-stream-m3u8',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
])
const subtitleMimeTypes = new Set([
  'application/ttml+xml',
  'application/x-srt',
  'application/x-subrip',
  'application/x-subtitle',
  'text/srt',
  'text/vtt',
  'text/x-ass',
  'text/x-srt',
  'text/x-ssa',
])
const capturedResourceKinds = new Set<CapturedResourceKind>([
  'document', 'image', 'key', 'manifest', 'media', 'other', 'subtitle',
])

function normalizeExtension(value?: string) {
  return String(value || '').trim().replace(/^\./, '').toLowerCase()
}

function normalizeMimeType(value?: string) {
  return String(value || '').split(';')[0]?.trim().toLowerCase() || ''
}

function parseUrlFile(url: string) {
  try {
    const rawName = new URL(url).pathname.split('/').pop() || ''
    const name = decodeURI(rawName)
    const extension = name.includes('.')
      ? normalizeExtension(name.split('.').pop())
      : ''
    return { extension, name: name || undefined }
  } catch {
    return { extension: '', name: undefined }
  }
}

function hasSubtitleMimeType(mimeType: string) {
  return subtitleMimeTypes.has(mimeType)
    || mimeType.includes('subrip')
    || mimeType.includes('subtitle')
    || mimeType.includes('ttml+xml')
}

export function classifyOmniFlowOnlyResource(
  input: OmniFlowResourceSignalInput,
): OmniFlowProductResourceKind | null {
  const parsedFile = parseUrlFile(input.url)
  const extension = normalizeExtension(input.extension) || parsedFile.extension
  const mimeType = normalizeMimeType(input.mimeType)
  const resourceType = String(input.resourceType || '').trim().toLowerCase()

  if (imageExtensions.has(extension) || mimeType.startsWith('image/')) return 'image'
  if (subtitleExtensions.has(extension) || hasSubtitleMimeType(mimeType)) return 'subtitle'
  if (extension === 'pdf' || mimeType === 'application/pdf') return 'document'
  if (keyExtensions.has(extension) || resourceType === 'key') return 'key'
  return null
}

/**
 * Cat Catch remains authoritative for its own network rules. OmniFlow additions
 * only fill product-owned resource kinds and never bypass a regex blacklist.
 */
export function classifyOmniFlowNetworkResource(
  input: NetworkResourceInput,
  rules: CatCatchCompiledRules,
): OmniFlowNetworkResourceClassification {
  const upstream = classifyResource(input, rules)
  if (upstream.decision === 'capture' || upstream.reason === 'regex-blacklist') {
    return upstream
  }
  if (input.stage !== 'response') return upstream

  const parsedFile = parseUrlFile(input.url)
  const kind = classifyOmniFlowOnlyResource({
    extension: parsedFile.extension,
    mimeType: input.mimeType,
    resourceType: input.resourceType,
    url: input.url,
  })
  if (!kind) return upstream

  return {
    decision: 'capture',
    extension: parsedFile.extension || undefined,
    kind,
    mimeType: normalizeMimeType(input.mimeType) || undefined,
    name: parsedFile.name,
    reason: `omniflow-${kind}`,
    url: input.url,
  }
}

export function classifyOmniFlowProbeResourceKind(
  input: OmniFlowResourceSignalInput,
): CapturedResourceKind {
  const parsedFile = parseUrlFile(input.url)
  const extension = normalizeExtension(input.extension) || parsedFile.extension
  const mimeType = normalizeMimeType(input.mimeType)
  const resourceType = String(input.resourceType || '').trim().toLowerCase()

  if (manifestExtensions.has(extension) || manifestMimeTypes.has(mimeType)) return 'manifest'
  if (
    mediaExtensions.has(extension)
    || mimeType.startsWith('audio/')
    || mimeType.startsWith('video/')
    || mimeType === 'application/m4s'
    || mimeType === 'application/ogg'
    || resourceType === 'media'
    || resourceType === 'mse-stream'
  ) {
    return 'media'
  }

  const productKind = classifyOmniFlowOnlyResource({
    extension,
    mimeType,
    resourceType,
    url: input.url,
  })
  if (productKind) return productKind

  const declaredKind = String(input.declaredKind || '').trim() as CapturedResourceKind
  return capturedResourceKinds.has(declaredKind) ? declaredKind : 'other'
}
