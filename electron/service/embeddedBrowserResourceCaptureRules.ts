/**
 * Defaults adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under GPL-3.0-only
 */
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import type { EmbeddedBrowserCapturedResourceKind } from './embeddedBrowserResourceTypes'
import type {
  EmbeddedBrowserCaptureRegexRule,
  EmbeddedBrowserCaptureRuleSet,
} from '@/features/embedded-browser/resources/model/embedded-browser-capture-rules'

const STORE_FILE_NAME = 'embedded-browser-resource-capture-rules.json'
const CAPTURE_RULE_SCHEMA_VERSION = 2

export type EmbeddedBrowserResourceRegexMatch = {
  blacklist: boolean
  ext?: string
  url: string
}

export type EmbeddedBrowserResourceCaptureEvaluation = {
  extHint?: string
  matchedByRuleSet: boolean
  url: string
}

export const catCatchManifestExtensions = [
  'm3u8',
  'm3u',
  'mpd',
] as const

export const catCatchMediaExtensions = [
  'flv',
  'hlv',
  'f4v',
  'mp4',
  'm4v',
  'm4a',
  'm4s',
  'mp3',
  'wma',
  'wav',
  'aac',
  'flac',
  'ts',
  'webm',
  'ogg',
  'oga',
  'ogv',
  'mov',
  'mkv',
  'mpeg',
  'avi',
  'wmv',
  'asf',
  'movie',
  'divx',
  'mpeg4',
  'vid',
  'weba',
  'opus',
  'acc',
  '3gp',
] as const

export const catCatchImageExtensions = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'ico',
] as const

export const catCatchSubtitleExtensions = [
  'vtt',
  'srt',
  'ass',
  'ssa',
  'ttml',
  'lrc',
  'qrc',
  'krc',
  'yrc',
  'trc',
  'ksc',
  'sbv',
  'dfxp',
  'smi',
  'sami',
  'scc',
  'stl',
  'sub',
  'idx',
  'sup',
  'lyric',
  'lyrics',
  'webvtt',
] as const

const catCatchExpandedSubtitleExtensions = [
  'lrc',
  'qrc',
  'krc',
  'yrc',
  'trc',
  'ksc',
  'sbv',
  'dfxp',
  'smi',
  'sami',
  'scc',
  'stl',
  'sub',
  'idx',
  'sup',
  'lyric',
  'lyrics',
  'webvtt',
] as const

export const catCatchKeyExtensions = [
  'key',
  'base64key',
] as const

export const catCatchMediaMimeTypes = [
  'application/ogg',
  'application/m4s',
] as const

export const catCatchSubtitleMimeTypes = [
  'text/vtt',
  'text/srt',
  'text/x-srt',
  'text/x-ass',
  'text/x-ssa',
  'application/x-subrip',
  'application/ttml+xml',
  'application/x-srt',
  'application/x-subtitle',
] as const

export const catCatchSubtitleMimeTypeIncludes = [
  'subrip',
  'subtitle',
  'ttml+xml',
] as const

export const catCatchManifestMimeTypeIncludes = [
  'mpegurl',
  'dash+xml',
] as const

export const catCatchDefaultBlockedPagePatterns = [
  /^https:\/\/.*\.douyin\.com\/.*$/i,
] as const

export const catCatchRelevantRequestHeaders = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'range',
  'referer',
  'user-agent',
] as const

export const catCatchDefaultRegexRules: EmbeddedBrowserCaptureRegexRule[] = [
  {
    builtIn: true,
    enabled: false,
    ext: 'json',
    flags: 'ig',
    id: 'iqiyi-json',
    label: '爱奇艺 JSON',
    pattern: String.raw`https://cache\.video\.[a-z]*\.com/dash\?tvid=.*`,
  },
  {
    blacklist: true,
    builtIn: true,
    enabled: true,
    ext: '',
    flags: 'ig',
    id: 'bilibili-live-m4s',
    label: 'B 站直播 m4s 屏蔽',
    pattern: String.raw`.*\.bilivideo\.(com|cn).*\/live-bvc\/.*m4s`,
  },
  {
    builtIn: true,
    enabled: false,
    ext: '',
    flags: 'ig',
    id: 'instagram-bytestart',
    label: 'Instagram bytestart 收敛',
    pattern: String.raw`(^https://scontent[a-z0-9-]*\.cdninstagram\.com/.*)&bytestart=.*`,
  },
  {
    builtIn: true,
    enabled: false,
    ext: '',
    flags: 'ig',
    id: 'facebook-bytestart',
    label: 'Facebook bytestart 收敛',
    pattern: String.raw`(^https://.*\.fbcdn\.net/.*)&bytestart=.*`,
  },
] as const

const defaultCaptureExtensions = [
  ...catCatchManifestExtensions,
  ...catCatchMediaExtensions,
  ...catCatchImageExtensions,
  ...catCatchSubtitleExtensions,
  ...catCatchKeyExtensions,
]

const defaultCaptureMimeTypes = [
  'video/*',
  'audio/*',
  ...catCatchMediaMimeTypes,
  ...catCatchSubtitleMimeTypes,
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'application/dash+xml',
]

let cachedRuleSet: EmbeddedBrowserCaptureRuleSet | null = null

export const catCatchManifestExtensionSet = new Set<string>(catCatchManifestExtensions)
export const catCatchMediaExtensionSet = new Set<string>(catCatchMediaExtensions)
export const catCatchImageExtensionSet = new Set<string>(catCatchImageExtensions)
export const catCatchSubtitleExtensionSet = new Set<string>(catCatchSubtitleExtensions)
export const catCatchKeyExtensionSet = new Set<string>(catCatchKeyExtensions)
export const catCatchMediaMimeTypeSet = new Set<string>(catCatchMediaMimeTypes)
export const catCatchSubtitleMimeTypeSet = new Set<string>(catCatchSubtitleMimeTypes)
export const catCatchRelevantRequestHeaderSet = new Set<string>(catCatchRelevantRequestHeaders)

function getRuleStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE_NAME)
}

function normalizeExtension(value: string) {
  return String(value || '').trim().replace(/^\./, '').toLowerCase()
}

function normalizeMimeTypePattern(value: string) {
  return String(value || '').trim().toLowerCase()
}

function normalizeDomain(value: string) {
  return String(value || '').trim().toLowerCase()
}

function inferExtensionFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const match = pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1] || ''
  } catch {
    const match = String(url || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i)
    return match?.[1] || ''
  }
}

function createDefaultRuleSet(): EmbeddedBrowserCaptureRuleSet {
  return {
    domainBlacklist: [],
    domainWhitelist: [],
    extensions: defaultCaptureExtensions.map(normalizeExtension),
    mimeTypes: defaultCaptureMimeTypes.map(normalizeMimeTypePattern),
    regexRules: catCatchDefaultRegexRules.map((rule) => ({
      ...rule,
      ext: normalizeExtension(rule.ext || '') || undefined,
    })),
    version: CAPTURE_RULE_SCHEMA_VERSION,
  }
}

function normalizeRegexRule(
  rule: Partial<EmbeddedBrowserCaptureRegexRule>,
): EmbeddedBrowserCaptureRegexRule | null {
  const pattern = String(rule.pattern || '').trim()
  if (!pattern) {
    return null
  }
  const flags = String(rule.flags || '').trim() || 'ig'
  try {
    // Validate regex syntax before persisting it.
    new RegExp(pattern, flags)
  } catch {
    return null
  }
  return {
    blacklist: Boolean(rule.blacklist),
    builtIn: Boolean(rule.builtIn),
    enabled: rule.enabled !== false,
    ext: normalizeExtension(rule.ext || '') || undefined,
    flags,
    id: String(rule.id || '').trim() || crypto.randomUUID(),
    label: String(rule.label || '').trim() || '未命名规则',
    pattern,
  }
}

function normalizeRuleSet(
  input?: Partial<EmbeddedBrowserCaptureRuleSet> | null,
): EmbeddedBrowserCaptureRuleSet {
  const defaults = createDefaultRuleSet()
  const inputVersion = Number(input?.version || 0)
  const shouldAppendNewDefaults = inputVersion < CAPTURE_RULE_SCHEMA_VERSION
  const extensions = Array.from(new Set([
    ...(input?.extensions || defaults.extensions).map(normalizeExtension).filter(Boolean),
    ...(shouldAppendNewDefaults ? catCatchExpandedSubtitleExtensions.map(normalizeExtension) : []),
  ]))
  const mimeTypes = Array.from(new Set([
    ...(input?.mimeTypes || defaults.mimeTypes).map(normalizeMimeTypePattern).filter(Boolean),
    ...(shouldAppendNewDefaults ? catCatchSubtitleMimeTypes.map(normalizeMimeTypePattern) : []),
  ]))
  const regexRules = Array.isArray(input?.regexRules)
    ? input?.regexRules.map(normalizeRegexRule).filter(Boolean) as EmbeddedBrowserCaptureRegexRule[]
    : defaults.regexRules
  return {
    domainBlacklist: Array.from(new Set((input?.domainBlacklist || []).map(normalizeDomain).filter(Boolean))),
    domainWhitelist: Array.from(new Set((input?.domainWhitelist || []).map(normalizeDomain).filter(Boolean))),
    extensions,
    mimeTypes,
    regexRules,
    version: CAPTURE_RULE_SCHEMA_VERSION,
  }
}

function loadStoredRuleSet(): EmbeddedBrowserCaptureRuleSet {
  if (cachedRuleSet) {
    return cachedRuleSet
  }
  const storePath = getRuleStorePath()
  if (!existsSync(storePath)) {
    cachedRuleSet = createDefaultRuleSet()
    return cachedRuleSet
  }
  try {
    const raw = readFileSync(storePath, 'utf-8')
    const parsed = JSON.parse(raw) as EmbeddedBrowserCaptureRuleSet
    cachedRuleSet = normalizeRuleSet(parsed)
    if (cachedRuleSet.version !== parsed.version) {
      saveStoredRuleSet(cachedRuleSet)
    }
    return cachedRuleSet
  } catch {
    cachedRuleSet = createDefaultRuleSet()
    return cachedRuleSet
  }
}

function saveStoredRuleSet(ruleSet: EmbeddedBrowserCaptureRuleSet) {
  cachedRuleSet = ruleSet
  const storePath = getRuleStorePath()
  const storeDir = path.dirname(storePath)
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true })
  }
  writeFileSync(storePath, JSON.stringify(ruleSet, null, 2), 'utf-8')
}

function extractHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function matchesDomainRule(hostname: string, domain: string) {
  const normalizedHostname = normalizeDomain(hostname)
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedHostname || !normalizedDomain) {
    return false
  }
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`)
}

function matchesMimePattern(mimeType: string, pattern: string) {
  const normalizedMime = normalizeMimeTypePattern(mimeType)
  const normalizedPattern = normalizeMimeTypePattern(pattern)
  if (!normalizedMime || !normalizedPattern) {
    return false
  }
  if (normalizedPattern.endsWith('/*')) {
    return normalizedMime.startsWith(`${normalizedPattern.slice(0, -1)}`)
  }
  return normalizedMime === normalizedPattern
}

export function listEmbeddedBrowserResourceCaptureRules(): EmbeddedBrowserCaptureRuleSet {
  return loadStoredRuleSet()
}

export function updateEmbeddedBrowserResourceCaptureRules(
  input: EmbeddedBrowserCaptureRuleSet,
): EmbeddedBrowserCaptureRuleSet {
  const normalized = normalizeRuleSet(input)
  saveStoredRuleSet(normalized)
  return normalized
}

export function resetEmbeddedBrowserResourceCaptureRules(): EmbeddedBrowserCaptureRuleSet {
  const nextRuleSet = createDefaultRuleSet()
  saveStoredRuleSet(nextRuleSet)
  return nextRuleSet
}

export function isCatCatchManifestMimeType(normalizedMimeType: string) {
  return catCatchManifestMimeTypeIncludes.some((value) => normalizedMimeType.includes(value))
}

export function isCatCatchMediaMimeType(normalizedMimeType: string) {
  return normalizedMimeType.startsWith('video/')
    || normalizedMimeType.startsWith('audio/')
    || catCatchMediaMimeTypeSet.has(normalizedMimeType)
}

export function isCatCatchSubtitleMimeType(normalizedMimeType: string) {
  return catCatchSubtitleMimeTypeSet.has(normalizedMimeType)
    || catCatchSubtitleMimeTypeIncludes.some((value) => normalizedMimeType.includes(value))
}

export function classifyCatCatchExtensionKind(
  extension: string,
): EmbeddedBrowserCapturedResourceKind | null {
  if (catCatchManifestExtensionSet.has(extension)) {
    return 'manifest'
  }
  if (catCatchMediaExtensionSet.has(extension)) {
    return 'media'
  }
  if (catCatchImageExtensionSet.has(extension)) {
    return 'image'
  }
  if (catCatchSubtitleExtensionSet.has(extension)) {
    return 'subtitle'
  }
  if (catCatchKeyExtensionSet.has(extension)) {
    return 'key'
  }
  return null
}

export function isCatCatchDefaultBlockedPageUrl(url: string) {
  const normalizedUrl = String(url || '').trim()
  return normalizedUrl
    ? catCatchDefaultBlockedPagePatterns.some((pattern) => pattern.test(normalizedUrl))
    : false
}

export function matchCatCatchRegexRule(
  url: string,
  rules: EmbeddedBrowserCaptureRegexRule[] = loadStoredRuleSet().regexRules,
) {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl) {
    return null
  }
  for (const rule of rules) {
    if (!rule.enabled) {
      continue
    }
    const regex = new RegExp(rule.pattern, rule.flags)
    const match = regex.exec(normalizedUrl)
    if (!match) {
      continue
    }
    if (rule.blacklist) {
      return {
        blacklist: true,
        ext: rule.ext || undefined,
        url: normalizedUrl,
      } satisfies EmbeddedBrowserResourceRegexMatch
    }
    if (match.length <= 1) {
      return {
        blacklist: false,
        ext: rule.ext || undefined,
        url: normalizedUrl,
      } satisfies EmbeddedBrowserResourceRegexMatch
    }
    const rewrittenPath = match.slice(1).map((value) => decodeURIComponent(value)).join('')
    let rewrittenUrl = rewrittenPath
    if (rewrittenUrl && !/^https?:\/\//i.test(rewrittenUrl)) {
      try {
        const parsedUrl = new URL(normalizedUrl)
        rewrittenUrl = `${parsedUrl.protocol}//${parsedUrl.host}${rewrittenUrl}`
      } catch {
        rewrittenUrl = normalizedUrl
      }
    }
    return {
      blacklist: false,
      ext: rule.ext || undefined,
      url: rewrittenUrl || normalizedUrl,
    } satisfies EmbeddedBrowserResourceRegexMatch
  }
  return null
}

export function evaluateEmbeddedBrowserResourceCapture(input: {
  ext?: string
  mimeType?: string
  pageUrl?: string
  resourceType?: string
  url: string
}) {
  const normalizedUrl = String(input.url || '').trim()
  if (!normalizedUrl || normalizedUrl.startsWith('data:')) {
    return null
  }
  const ruleSet = loadStoredRuleSet()
  const hostname = extractHostname(normalizedUrl) || extractHostname(String(input.pageUrl || '').trim())

  if (
    ruleSet.domainWhitelist.length > 0
    && hostname
    && !ruleSet.domainWhitelist.some((domain) => matchesDomainRule(hostname, domain))
  ) {
    return null
  }

  if (
    hostname
    && ruleSet.domainBlacklist.some((domain) => matchesDomainRule(hostname, domain))
  ) {
    return null
  }

  const regexMatch = matchCatCatchRegexRule(normalizedUrl, ruleSet.regexRules)
  if (regexMatch?.blacklist) {
    return null
  }

  const resolvedUrl = regexMatch?.url || normalizedUrl
  const extHint = normalizeExtension(regexMatch?.ext || input.ext || inferExtensionFromUrl(resolvedUrl)) || undefined
  const normalizedMimeType = normalizeMimeTypePattern(input.mimeType || '')
  const matchedExtension = extHint
    ? ruleSet.extensions.includes(extHint)
    : false
  const matchedMime = normalizedMimeType
    ? ruleSet.mimeTypes.some((pattern) => matchesMimePattern(normalizedMimeType, pattern))
    : false
  const hasTypeSignal = Boolean(extHint || normalizedMimeType)

  if (!regexMatch && hasTypeSignal && !matchedExtension && !matchedMime) {
    return null
  }

  return {
    extHint,
    matchedByRuleSet: Boolean(regexMatch || matchedExtension || matchedMime),
    url: resolvedUrl,
  } satisfies EmbeddedBrowserResourceCaptureEvaluation
}
