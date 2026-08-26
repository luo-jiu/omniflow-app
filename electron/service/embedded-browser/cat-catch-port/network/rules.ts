/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/init.js#G.OptionLists; js/background.js#operatorCheck
 * Reason: disabled defaults and size operators change whether later rules run.
 * Adaptation: arrays and storage snapshots are compiled into explicit Maps/RegExp objects.
 * Fixture: inline network.rule-ordering / network.mime-extension-dedupe cases
 */

export type CatCatchSizeOperator = '=' | '<' | '>' | '<=' | '>=' | '!=' | '~'

export type CatCatchSizedRule = {
  operator?: CatCatchSizeOperator
  size: number | string
  state: boolean
  unit?: string
}

export type CatCatchExtensionRule = CatCatchSizedRule & {
  ext: string
}

export type CatCatchMimeRule = CatCatchSizedRule & {
  type: string
}

export type CatCatchRegexRule = {
  blackList?: boolean
  ext?: string
  regex: string
  state: boolean
  type?: string
}

export type CompiledCatCatchSizedRule = CatCatchSizedRule & {
  max?: number
  min?: number
}

export type CompiledCatCatchRegexRule = Omit<CatCatchRegexRule, 'regex'> & {
  regex?: RegExp
}

export type CatCatchCompiledRules = {
  extensions: Map<string, CompiledCatCatchSizedRule>
  mimeTypes: Map<string, CompiledCatCatchSizedRule>
  regex: CompiledCatCatchRegexRule[]
}

export const CAT_CATCH_DEFAULT_EXTENSION_RULES: CatCatchExtensionRule[] = [
  { ext: 'flv', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'hlv', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'f4v', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mp4', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mp3', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'wma', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'wav', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'm4a', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'ts', size: 0, operator: '>=', unit: 'KB', state: false },
  { ext: 'webm', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'ogg', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'ogv', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'acc', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mov', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mkv', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'm4s', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'm3u8', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'm3u', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mpeg', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'avi', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'wmv', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'asf', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'movie', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'divx', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mpeg4', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'vid', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'aac', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'mpd', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'weba', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'opus', size: 0, operator: '>=', unit: 'KB', state: true },
  { ext: 'srt', size: 0, operator: '>=', unit: 'KB', state: false },
  { ext: 'vtt', size: 0, operator: '>=', unit: 'KB', state: false },
]

export const CAT_CATCH_DEFAULT_MIME_RULES: CatCatchMimeRule[] = [
  { type: 'audio/*', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'video/*', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/ogg', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/vnd.apple.mpegurl', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/x-mpegurl', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/mpegurl', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/octet-stream-m3u8', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/dash+xml', size: 0, operator: '>=', unit: 'KB', state: true },
  { type: 'application/m4s', size: 0, operator: '>=', unit: 'KB', state: true },
]

export const CAT_CATCH_DEFAULT_REGEX_RULES: CatCatchRegexRule[] = [
  {
    type: 'ig',
    regex: String.raw`https://cache\.video\.[a-z]*\.com/dash\?tvid=.*`,
    ext: 'json',
    state: false,
  },
  {
    type: 'ig',
    regex: String.raw`.*\.bilivideo\.(com|cn).*\/live-bvc\/.*m4s`,
    ext: '',
    blackList: true,
    state: false,
  },
  {
    type: 'ig',
    regex: String.raw`(^https://scontent[a-z0-9-]*\.cdninstagram\.com/.*)&bytestart=.*`,
    ext: '',
    blackList: false,
    state: false,
  },
  {
    type: 'ig',
    regex: String.raw`(^https://.*\.fbcdn\.net/.*)&bytestart=.*`,
    ext: '',
    blackList: false,
    state: false,
  },
]

function compileSizedRule(
  rule: CatCatchSizedRule,
  phase: 'initial' | 'storage-change',
): CompiledCatCatchSizedRule {
  const compiled: CompiledCatCatchSizedRule = { ...rule }
  if (phase === 'initial' && compiled.operator === undefined) {
    compiled.operator = '>='
  }
  if (compiled.operator === '~') {
    const [rawMin, rawMax] = String(compiled.size).split('-')
    compiled.min = rawMin ? Number.parseInt(rawMin, 10) : 0
    compiled.max = rawMax ? Number.parseInt(rawMax, 10) : 0
  }
  return compiled
}

export function compileCatCatchRules(input?: {
  extensions?: CatCatchExtensionRule[]
  mimeTypes?: CatCatchMimeRule[]
  phase?: 'initial' | 'storage-change'
  regex?: CatCatchRegexRule[]
}): CatCatchCompiledRules {
  const phase = input?.phase || 'initial'
  const extensionRules = input?.extensions || CAT_CATCH_DEFAULT_EXTENSION_RULES
  const mimeRules = input?.mimeTypes || CAT_CATCH_DEFAULT_MIME_RULES
  const regexRules = input?.regex || CAT_CATCH_DEFAULT_REGEX_RULES

  return {
    extensions: new Map(extensionRules.map(rule => [rule.ext, compileSizedRule(rule, phase)])),
    mimeTypes: new Map(mimeRules.map(rule => [rule.type, compileSizedRule(rule, phase)])),
    regex: regexRules.map((rule) => {
      try {
        return { ...rule, regex: new RegExp(rule.regex, rule.type) }
      } catch {
        return { ...rule, regex: undefined, state: false }
      }
    }),
  }
}

const CAT_CATCH_UNIT_MULTIPLIER: Record<string, number> = {
  B: 1,
  BYTE: 1,
  KB: 1024,
  MB: 1048576,
  GB: 1073741824,
}

export function checkCatCatchSize(size: number, rule: CompiledCatCatchSizedRule) {
  const unit = rule.unit || 'B'
  const multiplier = CAT_CATCH_UNIT_MULTIPLIER[unit] || 1
  const targetSize = Number(rule.size) * multiplier

  switch (rule.operator) {
    case '=':
      return size === targetSize
    case '<':
      return size < targetSize
    case '>':
      return size > targetSize
    case '<=':
      return size <= targetSize
    case '>=':
      return size >= targetSize
    case '!=':
      return size !== targetSize
    case '~':
      return (rule.min ? size >= rule.min * multiplier : true)
        && (rule.max ? size <= rule.max * multiplier : true)
    default:
      // The storage-change path does not backfill a missing operator upstream.
      return size <= targetSize
  }
}

export type CatCatchRuleCheck = boolean | 'break'

export function checkCatCatchExtension(
  extension: string,
  size: number | undefined,
  rules: CatCatchCompiledRules,
): CatCatchRuleCheck {
  const rule = rules.extensions.get(extension)
  if (!rule) return false
  if (!rule.state) return 'break'
  if (Number(rule.size) !== 0 && size !== undefined && !checkCatCatchSize(size, rule)) {
    return 'break'
  }
  return true
}

export function checkCatCatchMimeType(
  mimeType: string,
  size: number | undefined,
  rules: CatCatchCompiledRules,
): CatCatchRuleCheck {
  const wildcard = `${mimeType.split('/')[0]}/*`
  const rule = rules.mimeTypes.get(wildcard) || rules.mimeTypes.get(mimeType)
  if (!rule) return false
  if (!rule.state) return 'break'
  if (Number(rule.size) !== 0 && size !== undefined && !checkCatCatchSize(size, rule)) {
    return 'break'
  }
  return true
}
