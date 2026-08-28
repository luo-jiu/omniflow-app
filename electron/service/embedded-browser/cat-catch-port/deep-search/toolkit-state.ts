/**
 * Ported from xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * catch-script/catch.js#class CatCatcher/localStorage settings.
 *
 * Cat Catch keeps these settings in the visited page's localStorage. OmniFlow
 * retains that origin boundary while using product-specific key names and UI.
 */

export type CatchToolkitPreferences = {
  autoDownloadOnComplete: boolean
  autoSeekToBufferedEnd: boolean
  clearCacheOnComplete: boolean
  manualFileName: string
  regexRule: string
  restartAlwaysFromBeginning: boolean
  selectorRule: string
  trimExtraMediaHeaders: boolean
}

export type CatchToolkitState = CatchToolkitPreferences & {
  regexWarning: string
  selectorWarning: string
}

export type CatchToolkitStateOwner = {
  getState: () => CatchToolkitState
  update: (payload: Partial<CatchToolkitPreferences>) => CatchToolkitState
}

export type CatchToolkitStorage = {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

export type CatchToolkitSelectorScope = {
  querySelector: (selector: string) => null | {
    textContent?: string | null
  }
}

export type CreateCatchToolkitStateOptions = {
  selectorScope?: CatchToolkitSelectorScope
  storage?: CatchToolkitStorage
}

export function createCatchToolkitState(
  options: CreateCatchToolkitStateOptions = {},
): CatchToolkitStateOwner {
  const storageKeys = {
    autoDownloadOnComplete: 'OmniflowCatchToolkit:autoDownloadOnComplete',
    autoSeekToBufferedEnd: 'OmniflowCatchToolkit:autoSeekToBufferedEnd',
    clearCacheOnComplete: 'OmniflowCatchToolkit:clearCacheOnComplete',
    manualFileName: 'OmniflowCatchToolkit:manualFileName',
    regexRule: 'OmniflowCatchToolkit:regexRule',
    restartAlwaysFromBeginning: 'OmniflowCatchToolkit:restartAlwaysFromBeginning',
    selectorRule: 'OmniflowCatchToolkit:selectorRule',
    trimExtraMediaHeaders: 'OmniflowCatchToolkit:trimExtraMediaHeaders',
  }
  const createDefaults = (): CatchToolkitPreferences => ({
    autoDownloadOnComplete: false,
    autoSeekToBufferedEnd: false,
    clearCacheOnComplete: false,
    manualFileName: '',
    regexRule: '',
    restartAlwaysFromBeginning: false,
    selectorRule: '',
    trimExtraMediaHeaders: true,
  })
  const readString = (key: string) => {
    try {
      if (!options.storage) return ''
      return String(options.storage.getItem(key) || '').trim()
    } catch {
      return ''
    }
  }
  const readChecked = (key: string, fallback: boolean) => {
    try {
      if (!options.storage) return fallback
      return options.storage.getItem(key) === 'checked'
    } catch {
      return fallback
    }
  }
  const writeString = (key: string, value: string) => {
    try {
      if (!options.storage) return
      const normalizedValue = String(value || '').trim()
      if (!normalizedValue) {
        options.storage.removeItem(key)
        return
      }
      options.storage.setItem(key, normalizedValue)
    } catch {
      // Storage can be blocked by the page origin or browser policy.
    }
  }
  const writeChecked = (key: string, checked: boolean) => {
    try {
      if (!options.storage) return
      options.storage.setItem(key, checked ? 'checked' : '')
    } catch {
      // Storage failures must not disable page capture.
    }
  }
  const evaluateSelectorRule = (rule: string) => {
    const normalizedRule = String(rule || '').trim()
    if (!normalizedRule) return { rule: '', warning: '' }
    if (!options.selectorScope) return { rule: normalizedRule, warning: '' }
    try {
      const matchedNode = options.selectorScope.querySelector(normalizedRule)
      const matchedText = matchedNode?.textContent?.trim() || ''
      return {
        rule: normalizedRule,
        warning: matchedText ? '' : '表达式暂时没有命中可用内容',
      }
    } catch {
      return { rule: '', warning: '选择器语法错误' }
    }
  }
  const evaluateRegexRule = (rule: string) => {
    const normalizedRule = String(rule || '').trim()
    if (!normalizedRule) return { rule: '', warning: '' }
    try {
      new RegExp(normalizedRule, 'g')
      return { rule: normalizedRule, warning: '' }
    } catch {
      return { rule: '', warning: '正则表达式错误' }
    }
  }

  const defaults = createDefaults()
  const preferences: CatchToolkitPreferences = {
    autoDownloadOnComplete: readChecked(
      storageKeys.autoDownloadOnComplete,
      defaults.autoDownloadOnComplete,
    ),
    autoSeekToBufferedEnd: readChecked(
      storageKeys.autoSeekToBufferedEnd,
      defaults.autoSeekToBufferedEnd,
    ),
    clearCacheOnComplete: readChecked(
      storageKeys.clearCacheOnComplete,
      defaults.clearCacheOnComplete,
    ),
    manualFileName: readString(storageKeys.manualFileName),
    regexRule: evaluateRegexRule(readString(storageKeys.regexRule)).rule,
    restartAlwaysFromBeginning: readChecked(
      storageKeys.restartAlwaysFromBeginning,
      defaults.restartAlwaysFromBeginning,
    ),
    selectorRule: evaluateSelectorRule(readString(storageKeys.selectorRule)).rule,
    trimExtraMediaHeaders: readChecked(
      storageKeys.trimExtraMediaHeaders,
      defaults.trimExtraMediaHeaders,
    ),
  }

  const persist = () => {
    writeChecked(storageKeys.autoDownloadOnComplete, preferences.autoDownloadOnComplete)
    writeChecked(storageKeys.autoSeekToBufferedEnd, preferences.autoSeekToBufferedEnd)
    writeChecked(storageKeys.clearCacheOnComplete, preferences.clearCacheOnComplete)
    writeString(storageKeys.manualFileName, preferences.manualFileName)
    writeString(storageKeys.regexRule, preferences.regexRule)
    writeChecked(storageKeys.restartAlwaysFromBeginning, preferences.restartAlwaysFromBeginning)
    writeString(storageKeys.selectorRule, preferences.selectorRule)
    writeChecked(storageKeys.trimExtraMediaHeaders, preferences.trimExtraMediaHeaders)
  }
  const getState = (): CatchToolkitState => {
    const selectorEvaluation = evaluateSelectorRule(preferences.selectorRule)
    const regexEvaluation = evaluateRegexRule(preferences.regexRule)
    return {
      ...preferences,
      regexRule: regexEvaluation.rule,
      regexWarning: regexEvaluation.warning,
      selectorRule: selectorEvaluation.rule,
      selectorWarning: selectorEvaluation.warning,
    }
  }
  const update = (payload: Partial<CatchToolkitPreferences>) => {
    if (typeof payload.autoDownloadOnComplete === 'boolean') {
      preferences.autoDownloadOnComplete = payload.autoDownloadOnComplete
    }
    if (typeof payload.autoSeekToBufferedEnd === 'boolean') {
      preferences.autoSeekToBufferedEnd = payload.autoSeekToBufferedEnd
    }
    if (typeof payload.clearCacheOnComplete === 'boolean') {
      preferences.clearCacheOnComplete = payload.clearCacheOnComplete
    }
    if (typeof payload.manualFileName === 'string') {
      preferences.manualFileName = payload.manualFileName
    }
    if (typeof payload.regexRule === 'string') {
      preferences.regexRule = evaluateRegexRule(payload.regexRule).rule
    }
    if (typeof payload.restartAlwaysFromBeginning === 'boolean') {
      preferences.restartAlwaysFromBeginning = payload.restartAlwaysFromBeginning
    }
    if (typeof payload.selectorRule === 'string') {
      preferences.selectorRule = evaluateSelectorRule(payload.selectorRule).rule
    }
    if (typeof payload.trimExtraMediaHeaders === 'boolean') {
      preferences.trimExtraMediaHeaders = payload.trimExtraMediaHeaders
    }
    persist()
    return getState()
  }

  return { getState, update }
}

export function createCatchToolkitStateSource() {
  return `(${createCatchToolkitState.toString()})`
}
