/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/function.js#isDamnUrl/isLockUrl; js/init.js#wildcardToRegex;
 *   js/background.js#findMedia/isSpecialPage
 * Reason: page filters are tab policy inputs and must not be confused with resource-host rules.
 * Adaptation: none; per-tab membership stays in the later adapter.
 * Fixture: inline network.url-filtering-parity / network.special-page-parity cases
 */

export type CatCatchUrlFilterRule = {
  state: boolean
  url: string
}

export type CompiledCatCatchUrlFilterRule = Omit<CatCatchUrlFilterRule, 'url'> & {
  url: RegExp
}

export type CatCatchPageUrlPolicyDecision = {
  decision: 'allow' | 'block'
  reason: 'allow' | 'forced-block' | 'special-page' | 'url-filter' | 'url-filter-miss'
}

export const CAT_CATCH_DEFAULT_FORCED_BLOCK_PATTERNS: readonly RegExp[] = [
  /^https:\/\/.*\.douyin\.com\/.*$/i,
]

export function catCatchWildcardToRegex(urlPattern: string) {
  const regexPattern = urlPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${regexPattern}$`, 'i')
}

export function compileCatCatchUrlFilterRules(
  rules: CatCatchUrlFilterRule[],
): CompiledCatCatchUrlFilterRule[] {
  return rules.map(rule => ({
    state: rule.state,
    url: catCatchWildcardToRegex(rule.url),
  }))
}

export function matchesCatCatchUrlFilter(
  url: string,
  rules: readonly CompiledCatCatchUrlFilterRule[],
) {
  for (const rule of rules) {
    if (!rule.state) continue
    rule.url.lastIndex = 0
    if (rule.url.test(url)) return true
  }
  return false
}

export function isCatCatchForcedBlockedUrl(
  url: string,
  patterns: readonly RegExp[] = CAT_CATCH_DEFAULT_FORCED_BLOCK_PATTERNS,
) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    if (pattern.test(url)) return true
  }
  return false
}

export function evaluateCatCatchPageUrlPolicy(input: {
  blockUrlWhite?: boolean
  damn?: boolean
  forcedBlockPatterns?: readonly RegExp[]
  rules: readonly CompiledCatCatchUrlFilterRule[]
  url: string
}): CatCatchPageUrlPolicyDecision {
  if (isCatCatchSpecialPageUrl(input.url)) {
    return { decision: 'block', reason: 'special-page' }
  }
  if (
    input.damn
    && isCatCatchForcedBlockedUrl(input.url, input.forcedBlockPatterns)
  ) {
    return { decision: 'block', reason: 'forced-block' }
  }

  const matchesUrlFilter = matchesCatCatchUrlFilter(input.url, input.rules)
  if (input.blockUrlWhite) {
    return matchesUrlFilter
      ? { decision: 'allow', reason: 'allow' }
      : { decision: 'block', reason: 'url-filter-miss' }
  }
  return matchesUrlFilter
    ? { decision: 'block', reason: 'url-filter' }
    : { decision: 'allow', reason: 'allow' }
}

export function isCatCatchSpecialPageUrl(url?: string | null) {
  if (!url || url === 'null') return true
  return !(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:'))
}
