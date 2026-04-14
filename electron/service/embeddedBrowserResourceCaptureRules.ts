/**
 * Defaults adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
import type { EmbeddedBrowserCapturedResourceKind } from './embeddedBrowserResourceTypes'

export type EmbeddedBrowserResourceRegexRule = {
  blacklist?: boolean
  ext?: string
  flags: string
  pattern: string
  state: boolean
}

export type EmbeddedBrowserResourceRegexMatch = {
  blacklist: boolean
  ext?: string
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
] as const

export const catCatchKeyExtensions = [
  'key',
  'base64key',
] as const

export const catCatchMediaMimeTypes = [
  'application/ogg',
  'application/m4s',
] as const

export const catCatchManifestMimeTypeIncludes = [
  'mpegurl',
  'dash+xml',
] as const

export const catCatchDefaultRegexRules: EmbeddedBrowserResourceRegexRule[] = [
  {
    flags: 'ig',
    pattern: String.raw`https://cache\.video\.[a-z]*\.com/dash\?tvid=.*`,
    ext: 'json',
    state: false,
  },
  {
    flags: 'ig',
    pattern: String.raw`.*\.bilivideo\.(com|cn).*\/live-bvc\/.*m4s`,
    blacklist: true,
    ext: '',
    state: false,
  },
  {
    flags: 'ig',
    pattern: String.raw`(^https://scontent[a-z0-9-]*\.cdninstagram\.com/.*)&bytestart=.*`,
    ext: '',
    state: false,
  },
  {
    flags: 'ig',
    pattern: String.raw`(^https://.*\.fbcdn\.net/.*)&bytestart=.*`,
    ext: '',
    state: false,
  },
]

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

export const catCatchManifestExtensionSet = new Set<string>(catCatchManifestExtensions)
export const catCatchMediaExtensionSet = new Set<string>(catCatchMediaExtensions)
export const catCatchImageExtensionSet = new Set<string>(catCatchImageExtensions)
export const catCatchSubtitleExtensionSet = new Set<string>(catCatchSubtitleExtensions)
export const catCatchKeyExtensionSet = new Set<string>(catCatchKeyExtensions)
export const catCatchMediaMimeTypeSet = new Set<string>(catCatchMediaMimeTypes)
export const catCatchRelevantRequestHeaderSet = new Set<string>(catCatchRelevantRequestHeaders)

export function isCatCatchManifestMimeType(normalizedMimeType: string) {
  return catCatchManifestMimeTypeIncludes.some((value) => normalizedMimeType.includes(value))
}

export function isCatCatchMediaMimeType(normalizedMimeType: string) {
  return normalizedMimeType.startsWith('video/')
    || normalizedMimeType.startsWith('audio/')
    || catCatchMediaMimeTypeSet.has(normalizedMimeType)
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
  rules: EmbeddedBrowserResourceRegexRule[] = catCatchDefaultRegexRules,
) {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl) {
    return null
  }
  for (const rule of rules) {
    if (!rule.state) {
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
