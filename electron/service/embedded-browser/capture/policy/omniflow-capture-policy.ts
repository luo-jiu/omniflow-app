import type { CapturedResourceKind } from '../../contracts/captured-resource'
import {
  classifyResource,
  type NetworkResourceClassification,
  type NetworkResourceInput,
} from '../../cat-catch-port/network/classifier'
import {
  CAT_CATCH_DEFAULT_EXTENSION_RULES,
  CAT_CATCH_DEFAULT_MIME_RULES,
  compileCatCatchRules,
  type CatCatchCompiledRules,
  type CatCatchExtensionRule,
  type CatCatchMimeRule,
  type CatCatchRegexRule,
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

export type OmniFlowCaptureRegexSetting = {
  blacklist?: boolean
  enabled?: boolean
  ext?: string
  flags?: string
  pattern: string
}

export type OmniFlowCaptureSettings = {
  domainBlacklist?: readonly string[]
  domainWhitelist?: readonly string[]
  extensions?: readonly string[]
  mimeTypes?: readonly string[]
  regexRules?: readonly OmniFlowCaptureRegexSetting[]
}

export type CompiledOmniFlowCaptureSettings = {
  allowsProductResource(input: OmniFlowResourceSignalInput): boolean
  allowsResourceUrl(input: { pageUrl?: string; url: string }): boolean
  rules: CatCatchCompiledRules
}

export type OmniFlowProductCapturePolicy = Pick<
  CompiledOmniFlowCaptureSettings,
  'allowsProductResource'
>

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

function matchesMimePattern(mimeType: string, pattern: string) {
  if (!mimeType || !pattern) return false
  return pattern.endsWith('/*')
    ? mimeType.startsWith(pattern.slice(0, -1))
    : mimeType === pattern
}

function normalizeDomain(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function extractHostname(value: unknown) {
  try {
    return new URL(String(value ?? '')).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function compileExtensionSettings(extensions: Set<string>): CatCatchExtensionRule[] {
  const known = new Set<string>()
  const rules = CAT_CATCH_DEFAULT_EXTENSION_RULES.map((rule) => {
    known.add(rule.ext)
    return { ...rule, state: extensions.has(rule.ext) }
  })
  for (const extension of extensions) {
    if (known.has(extension)) continue
    rules.push({ ext: extension, operator: '>=', size: 0, state: true, unit: 'KB' })
  }
  return rules
}

function compileMimeSettings(mimeTypes: Set<string>): CatCatchMimeRule[] {
  const known = new Set<string>()
  const rules = CAT_CATCH_DEFAULT_MIME_RULES.map((rule) => {
    known.add(rule.type)
    return { ...rule, state: mimeTypes.has(rule.type) }
  })
  for (const mimeType of mimeTypes) {
    if (known.has(mimeType)) continue
    rules.push({ operator: '>=', size: 0, state: true, type: mimeType, unit: 'KB' })
  }
  return rules
}

function compileRegexSettings(settings: readonly OmniFlowCaptureRegexSetting[]) {
  return settings.map((setting): CatCatchRegexRule => ({
    blackList: Boolean(setting.blacklist),
    ext: normalizeExtension(setting.ext),
    regex: String(setting.pattern || ''),
    state: setting.enabled !== false,
    type: String(setting.flags || '').trim() || 'ig',
  }))
}

/** Compiles the persisted OmniFlow settings without reimplementing Cat Catch rules. */
export function compileOmniFlowCaptureSettings(
  input: OmniFlowCaptureSettings,
): CompiledOmniFlowCaptureSettings {
  const extensions = new Set((input.extensions || []).map(normalizeExtension).filter(Boolean))
  const mimeTypes = new Set((input.mimeTypes || []).map(normalizeMimeType).filter(Boolean))
  const domainBlacklist = Array.from(new Set(
    (input.domainBlacklist || []).map(normalizeDomain).filter(Boolean),
  ))
  const domainWhitelist = Array.from(new Set(
    (input.domainWhitelist || []).map(normalizeDomain).filter(Boolean),
  ))

  return {
    allowsProductResource(resource) {
      const parsedFile = parseUrlFile(resource.url)
      const extension = normalizeExtension(resource.extension) || parsedFile.extension
      const mimeType = normalizeMimeType(resource.mimeType)
      if (extension && extensions.has(extension)) return true
      if (mimeType && Array.from(mimeTypes).some(pattern => matchesMimePattern(mimeType, pattern))) {
        return true
      }
      return String(resource.resourceType || '').toLowerCase() === 'key'
        && (extensions.has('key') || extensions.has('base64key'))
    },
    allowsResourceUrl({ pageUrl, url }) {
      const hostname = extractHostname(url) || extractHostname(pageUrl)
      if (
        domainWhitelist.length > 0
        && hostname
        && !domainWhitelist.some(domain => matchesDomain(hostname, domain))
      ) {
        return false
      }
      return !hostname || !domainBlacklist.some(domain => matchesDomain(hostname, domain))
    },
    rules: compileCatCatchRules({
      extensions: compileExtensionSettings(extensions),
      mimeTypes: compileMimeSettings(mimeTypes),
      regex: compileRegexSettings(input.regexRules || []),
    }),
  }
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
  productPolicy?: OmniFlowProductCapturePolicy,
): OmniFlowNetworkResourceClassification {
  const upstream = classifyResource(input, rules)
  if (upstream.decision === 'capture') {
    const productKind = upstream.kind === 'other'
      ? classifyOmniFlowOnlyResource({
        extension: upstream.extension,
        mimeType: upstream.mimeType || input.mimeType,
        resourceType: input.resourceType,
        url: upstream.url,
      })
      : null
    if (productKind) return { ...upstream, kind: productKind }
    if (
      upstream.kind === 'other'
      && (
        normalizeMimeType(input.mimeType).startsWith('audio/')
        || normalizeMimeType(input.mimeType).startsWith('video/')
        || input.resourceType === 'media'
      )
    ) {
      return { ...upstream, kind: 'media' }
    }
    return upstream
  }
  if (upstream.reason === 'regex-blacklist') {
    return upstream
  }
  if (input.stage !== 'response') return upstream

  const parsedFile = parseUrlFile(input.url)
  const mimeType = normalizeMimeType(input.mimeType)
  const kind = classifyOmniFlowOnlyResource({
    extension: parsedFile.extension,
    mimeType,
    resourceType: input.resourceType,
    url: input.url,
  })
  if (!kind) return upstream
  if (productPolicy && !productPolicy.allowsProductResource({
    extension: parsedFile.extension,
    mimeType,
    resourceType: input.resourceType,
    url: input.url,
  })) {
    return upstream
  }

  return {
    decision: 'capture',
    extension: parsedFile.extension || undefined,
    kind,
    mimeType: mimeType || undefined,
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
