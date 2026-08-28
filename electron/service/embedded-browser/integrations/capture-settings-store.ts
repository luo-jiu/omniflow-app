/**
 * Defaults adapted from xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138.
 * The persisted shape and OmniFlow additions remain product-owned integration.
 */
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import type {
  EmbeddedBrowserCaptureRegexRule,
  EmbeddedBrowserCaptureRuleSet,
} from '../contracts/capture-settings'

const STORE_FILE_NAME = 'embedded-browser-resource-capture-rules.json'
const CAPTURE_RULE_SCHEMA_VERSION = 2

const defaultCaptureExtensions = [
  'm3u8', 'm3u', 'mpd',
  'flv', 'hlv', 'f4v', 'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'wma', 'wav',
  'aac', 'flac', 'ts', 'webm', 'ogg', 'oga', 'ogv', 'mov', 'mkv', 'mpeg',
  'avi', 'wmv', 'asf', 'movie', 'divx', 'mpeg4', 'vid', 'weba', 'opus', 'acc', '3gp',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico',
  'vtt', 'srt', 'ass', 'ssa', 'ttml', 'lrc', 'qrc', 'krc', 'yrc', 'trc', 'ksc',
  'sbv', 'dfxp', 'smi', 'sami', 'scc', 'stl', 'sub', 'idx', 'sup', 'lyric',
  'lyrics', 'webvtt', 'key', 'base64key',
]

const expandedSubtitleExtensions = [
  'lrc', 'qrc', 'krc', 'yrc', 'trc', 'ksc', 'sbv', 'dfxp', 'smi', 'sami',
  'scc', 'stl', 'sub', 'idx', 'sup', 'lyric', 'lyrics', 'webvtt',
]

const subtitleMimeTypes = [
  'text/vtt',
  'text/srt',
  'text/x-srt',
  'text/x-ass',
  'text/x-ssa',
  'application/x-subrip',
  'application/ttml+xml',
  'application/x-srt',
  'application/x-subtitle',
]

const defaultCaptureMimeTypes = [
  'video/*',
  'audio/*',
  'application/ogg',
  'application/m4s',
  ...subtitleMimeTypes,
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'application/dash+xml',
]

const defaultCaptureRegexRules: EmbeddedBrowserCaptureRegexRule[] = [
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
]

type EmbeddedBrowserCaptureSettingsStoreOptions = {
  createRuleId?: () => string
  storePath?: string
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

export class EmbeddedBrowserCaptureSettingsStore {
  private cachedRuleSet: EmbeddedBrowserCaptureRuleSet | null = null
  private readonly createRuleId: () => string
  private readonly explicitStorePath?: string

  constructor(options: EmbeddedBrowserCaptureSettingsStoreOptions = {}) {
    this.createRuleId = options.createRuleId || crypto.randomUUID
    this.explicitStorePath = options.storePath
  }

  list(): EmbeddedBrowserCaptureRuleSet {
    return this.loadStoredRuleSet()
  }

  reset(): EmbeddedBrowserCaptureRuleSet {
    const nextRuleSet = this.createDefaultRuleSet()
    this.saveStoredRuleSet(nextRuleSet)
    return nextRuleSet
  }

  update(input: EmbeddedBrowserCaptureRuleSet): EmbeddedBrowserCaptureRuleSet {
    const normalized = this.normalizeRuleSet(input)
    this.saveStoredRuleSet(normalized)
    return normalized
  }

  private createDefaultRuleSet(): EmbeddedBrowserCaptureRuleSet {
    return {
      domainBlacklist: [],
      domainWhitelist: [],
      extensions: defaultCaptureExtensions.map(normalizeExtension),
      mimeTypes: defaultCaptureMimeTypes.map(normalizeMimeTypePattern),
      regexRules: defaultCaptureRegexRules.map(rule => ({
        ...rule,
        ext: normalizeExtension(rule.ext || '') || undefined,
      })),
      version: CAPTURE_RULE_SCHEMA_VERSION,
    }
  }

  private getStorePath() {
    return this.explicitStorePath || path.join(app.getPath('userData'), STORE_FILE_NAME)
  }

  private loadStoredRuleSet(): EmbeddedBrowserCaptureRuleSet {
    if (this.cachedRuleSet) return this.cachedRuleSet
    const storePath = this.getStorePath()
    if (!existsSync(storePath)) {
      this.cachedRuleSet = this.createDefaultRuleSet()
      return this.cachedRuleSet
    }
    try {
      const raw = readFileSync(storePath, 'utf-8')
      const parsed = JSON.parse(raw) as EmbeddedBrowserCaptureRuleSet
      this.cachedRuleSet = this.normalizeRuleSet(parsed)
      if (this.cachedRuleSet.version !== parsed.version) {
        this.saveStoredRuleSet(this.cachedRuleSet)
      }
      return this.cachedRuleSet
    } catch {
      this.cachedRuleSet = this.createDefaultRuleSet()
      return this.cachedRuleSet
    }
  }

  private normalizeRegexRule(
    rule: Partial<EmbeddedBrowserCaptureRegexRule>,
  ): EmbeddedBrowserCaptureRegexRule | null {
    const pattern = String(rule.pattern || '').trim()
    if (!pattern) return null
    const flags = String(rule.flags || '').trim() || 'ig'
    try {
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
      id: String(rule.id || '').trim() || this.createRuleId(),
      label: String(rule.label || '').trim() || '未命名规则',
      pattern,
    }
  }

  private normalizeRuleSet(
    input?: Partial<EmbeddedBrowserCaptureRuleSet> | null,
  ): EmbeddedBrowserCaptureRuleSet {
    const defaults = this.createDefaultRuleSet()
    const shouldAppendNewDefaults = Number(input?.version || 0) < CAPTURE_RULE_SCHEMA_VERSION
    return {
      domainBlacklist: Array.from(new Set(
        (input?.domainBlacklist || []).map(normalizeDomain).filter(Boolean),
      )),
      domainWhitelist: Array.from(new Set(
        (input?.domainWhitelist || []).map(normalizeDomain).filter(Boolean),
      )),
      extensions: Array.from(new Set([
        ...(input?.extensions || defaults.extensions).map(normalizeExtension).filter(Boolean),
        ...(shouldAppendNewDefaults ? expandedSubtitleExtensions.map(normalizeExtension) : []),
      ])),
      mimeTypes: Array.from(new Set([
        ...(input?.mimeTypes || defaults.mimeTypes).map(normalizeMimeTypePattern).filter(Boolean),
        ...(shouldAppendNewDefaults ? subtitleMimeTypes.map(normalizeMimeTypePattern) : []),
      ])),
      regexRules: Array.isArray(input?.regexRules)
        ? input.regexRules
          .map(rule => this.normalizeRegexRule(rule))
          .filter((rule): rule is EmbeddedBrowserCaptureRegexRule => Boolean(rule))
        : defaults.regexRules,
      version: CAPTURE_RULE_SCHEMA_VERSION,
    }
  }

  private saveStoredRuleSet(ruleSet: EmbeddedBrowserCaptureRuleSet) {
    this.cachedRuleSet = ruleSet
    const storePath = this.getStorePath()
    const storeDir = path.dirname(storePath)
    if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true })
    writeFileSync(storePath, JSON.stringify(ruleSet, null, 2), 'utf-8')
  }
}

const defaultCaptureSettingsStore = new EmbeddedBrowserCaptureSettingsStore()

export function listEmbeddedBrowserCaptureSettings() {
  return defaultCaptureSettingsStore.list()
}

export function resetEmbeddedBrowserCaptureSettings() {
  return defaultCaptureSettingsStore.reset()
}

export function updateEmbeddedBrowserCaptureSettings(input: EmbeddedBrowserCaptureRuleSet) {
  return defaultCaptureSettingsStore.update(input)
}
