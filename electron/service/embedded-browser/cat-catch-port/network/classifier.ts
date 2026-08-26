import {
  CAT_CATCH_DEFAULT_EXTENSION_RULES,
  checkCatCatchExtension,
  checkCatCatchMimeType,
  type CatCatchCompiledRules,
} from './rules'

export type NetworkResourceKind = 'manifest' | 'media' | 'subtitle' | 'other'

export type NetworkResourceClassification = {
  decision: 'capture' | 'ignore' | 'reject'
  extension?: string
  kind?: NetworkResourceKind
  mimeType?: string
  name?: string
  reason:
    | 'regex'
    | 'regex-blacklist'
    | 'extension'
    | 'extension-disabled-or-size'
    | 'mime-type'
    | 'mime-disabled-or-size'
    | 'content-disposition'
    | 'content-disposition-extension-disabled-or-size'
    | 'resource-type'
    | 'invalid-url'
    | 'invalid-regex-capture'
    | 'no-regex-match'
    | 'no-match'
  url: string
}

export type NetworkResourceInput = {
  contentDisposition?: string
  mimeType?: string
  resourceType?: string
  size?: number
  stage: 'request' | 'response'
  url: string
}

export type ResourceFingerprintDecision = {
  decision: 'accept' | 'duplicate'
  effect: 'none' | 'record' | 'record-then-reset'
  fingerprint: string
}

const attachmentFilename = /filename="?([^"]+)"?/
const duplicateScanResourceLimit = 500
const fingerprintResetSize = 500
const manifestExtensions = new Set(['m3u8', 'm3u', 'mpd'])
const subtitleExtensions = new Set(['srt', 'vtt'])
const manifestMimeTypes = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/mpegurl',
  'application/octet-stream-m3u8',
  'application/dash+xml',
])
const knownMediaExtensions = new Set(
  CAT_CATCH_DEFAULT_EXTENSION_RULES
    .map(rule => rule.ext)
    .filter(extension => !manifestExtensions.has(extension) && !subtitleExtensions.has(extension)),
)

function normalizeExtension(value?: string) {
  return String(value || '').trim().replace(/^\./, '').toLowerCase()
}

function normalizeMimeType(value?: string) {
  return String(value || '').split(';')[0]?.trim().toLowerCase() || ''
}

function parsePathFileName(pathname: string) {
  let name: string
  try {
    name = decodeURI(pathname.split('/').pop() || '')
  } catch {
    return null
  }
  const pieces = name.split('.')
  const extension = pieces.length > 1
    ? normalizeExtension(pieces.at(-1)) || undefined
    : undefined
  return { extension, name }
}

function parseUrlFileName(url: string) {
  try {
    return parsePathFileName(new URL(url).pathname)
  } catch {
    return null
  }
}

function kindFromExtension(extension?: string): NetworkResourceKind {
  const normalized = normalizeExtension(extension)
  if (manifestExtensions.has(normalized)) return 'manifest'
  if (subtitleExtensions.has(normalized)) return 'subtitle'
  if (knownMediaExtensions.has(normalized)) return 'media'
  return 'other'
}

function kindFromMimeType(mimeType: string): NetworkResourceKind {
  if (manifestMimeTypes.has(mimeType)) return 'manifest'
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return 'media'
  if (mimeType === 'application/ogg' || mimeType === 'application/m4s') return 'media'
  return 'other'
}

function capture(input: {
  extension?: string
  kind: NetworkResourceKind
  mimeType?: string
  name?: string
  reason: NetworkResourceClassification['reason']
  url: string
}): NetworkResourceClassification {
  return {
    decision: 'capture',
    extension: input.extension,
    kind: input.kind,
    mimeType: input.mimeType,
    name: input.name,
    reason: input.reason,
    url: input.url,
  }
}

function classifyRequest(
  input: NetworkResourceInput,
  rules: CatCatchCompiledRules,
): NetworkResourceClassification {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.url)
  } catch {
    return { decision: 'ignore', reason: 'invalid-url', url: input.url }
  }

  for (const rule of rules.regex) {
    if (!rule.state || !rule.regex) continue
    rule.regex.lastIndex = 0
    const match = rule.regex.exec(input.url)
    if (!match) continue
    if (rule.blackList) {
      return { decision: 'reject', reason: 'regex-blacklist', url: input.url }
    }

    let url = input.url
    if (match.length > 1) {
      try {
        const captures = match.slice(1).map(value => decodeURIComponent(value))
        if (!captures[0].startsWith('https://') && !captures[0].startsWith('http://')) {
          // This odd prefix is the pinned behavior for custom relative captures.
          captures[0] = `${parsedUrl.protocol}//${input.url}`
        }
        url = captures.join('')
      } catch {
        return { decision: 'ignore', reason: 'invalid-regex-capture', url: input.url }
      }
    }
    const parsedFile = parseUrlFileName(url)
    if (!parsedFile) {
      return { decision: 'ignore', reason: 'invalid-regex-capture', url: input.url }
    }
    const extension = normalizeExtension(rule.ext) || parsedFile.extension
    return capture({
      extension,
      kind: kindFromExtension(extension),
      name: parsedFile.name,
      reason: 'regex',
      url,
    })
  }

  return { decision: 'ignore', reason: 'no-regex-match', url: input.url }
}

function classifyResponse(
  input: NetworkResourceInput,
  rules: CatCatchCompiledRules,
): NetworkResourceClassification {
  let parsedFile = parseUrlFileName(input.url)
  if (!parsedFile) {
    return { decision: 'ignore', reason: 'invalid-url', url: input.url }
  }

  const mimeType = normalizeMimeType(input.mimeType)
  if (parsedFile.extension !== undefined) {
    const extensionDecision = checkCatCatchExtension(parsedFile.extension, input.size, rules)
    if (extensionDecision === 'break') {
      return {
        decision: 'reject',
        extension: parsedFile.extension,
        mimeType: mimeType || undefined,
        reason: 'extension-disabled-or-size',
        url: input.url,
      }
    }
    if (extensionDecision) {
      return capture({
        extension: parsedFile.extension,
        kind: kindFromExtension(parsedFile.extension),
        mimeType: mimeType || undefined,
        name: parsedFile.name,
        reason: 'extension',
        url: input.url,
      })
    }
  }

  if (mimeType) {
    const mimeDecision = checkCatCatchMimeType(mimeType, input.size, rules)
    if (mimeDecision === 'break') {
      return {
        decision: 'reject',
        mimeType,
        reason: 'mime-disabled-or-size',
        url: input.url,
      }
    }
    if (mimeDecision) {
      return capture({
        extension: parsedFile.extension || mimeType.split('/')[1] || undefined,
        kind: kindFromMimeType(mimeType),
        mimeType,
        name: parsedFile.name,
        reason: 'mime-type',
        url: input.url,
      })
    }
  }

  const attachment = input.contentDisposition?.match(attachmentFilename)
  if (attachment?.[1]) {
    try {
      const parsedAttachment = parsePathFileName(decodeURIComponent(attachment[1]))
      if (!parsedAttachment) {
        return { decision: 'ignore', reason: 'no-match', url: input.url }
      }
      parsedFile = parsedAttachment
    } catch {
      return { decision: 'ignore', reason: 'no-match', url: input.url }
    }
    const attachmentDecision = checkCatCatchExtension(parsedFile.extension || '', 0, rules)
    if (attachmentDecision === 'break') {
      return {
        decision: 'reject',
        extension: parsedFile.extension,
        mimeType: mimeType || undefined,
        reason: 'content-disposition-extension-disabled-or-size',
        url: input.url,
      }
    }
    if (attachmentDecision) {
      return capture({
        extension: parsedFile.extension,
        kind: kindFromExtension(parsedFile.extension),
        mimeType: mimeType || undefined,
        name: parsedFile.name,
        reason: 'content-disposition',
        url: input.url,
      })
    }
  }

  if (input.resourceType === 'media') {
    return capture({
      extension: parsedFile.extension || mimeType.split('/')[1] || undefined,
      kind: 'media',
      mimeType: mimeType || undefined,
      name: parsedFile.name,
      reason: 'resource-type',
      url: input.url,
    })
  }

  return { decision: 'ignore', reason: 'no-match', url: input.url }
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/background.js#findMedia / CheckExtension / CheckType / fileNameParse
 * Reason: first-match regex and hard-reject ordering preserve capture behavior.
 * Adaptation: event fields and the request/response stage are explicit inputs.
 * Fixture: inline network.rule-ordering / network.mime-extension-dedupe cases
 */
export function classifyResource(
  input: NetworkResourceInput,
  rules: CatCatchCompiledRules,
): NetworkResourceClassification {
  return input.stage === 'request'
    ? classifyRequest(input, rules)
    : classifyResponse(input, rules)
}

/**
 * Pure transition for the upstream's exact-URL dedupe. The state adapter owns
 * one Set per tab and applies the returned record/reset instructions.
 */
export function classifyResourceFingerprint(input: {
  capturedResourceCount: number
  checkDuplicates?: boolean
  fingerprints: ReadonlySet<string>
  url: string
}): ResourceFingerprintDecision {
  const fingerprint = input.url
  if (input.checkDuplicates === false || input.capturedResourceCount > duplicateScanResourceLimit) {
    return {
      decision: 'accept',
      effect: 'none',
      fingerprint,
    }
  }
  if (input.fingerprints.has(fingerprint)) {
    return {
      decision: 'duplicate',
      effect: 'none',
      fingerprint,
    }
  }
  return {
    decision: 'accept',
    effect: input.fingerprints.size + 1 >= fingerprintResetSize
      ? 'record-then-reset'
      : 'record',
    fingerprint,
  }
}
