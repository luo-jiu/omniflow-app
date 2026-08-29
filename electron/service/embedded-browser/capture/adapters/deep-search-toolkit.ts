import {
  createCatchToolkitStateSource,
  type CatchToolkitPreferences,
  type CatchToolkitSelectorScope,
  type CatchToolkitState,
  type CatchToolkitStateOwner,
  type CatchToolkitStorage,
  type CreateCatchToolkitStateOptions,
} from '../../cat-catch-port/deep-search/toolkit-state'

type CatchToolkitStateFactory = (
  options?: CreateCatchToolkitStateOptions,
) => CatchToolkitStateOwner

type CatchToolkitHostState = CatchToolkitState & Record<string, unknown>

type CatchToolkitHostProbe = {
  getCatchToolkitState?: () => CatchToolkitHostState
  updateCatchToolkitState?: (
    payload: Partial<CatchToolkitPreferences>,
  ) => CatchToolkitHostState
}

export type DeepSearchToolkitAdapter = {
  dispose: () => void
  getState: () => CatchToolkitState
  isDisposed: () => boolean
}

export type InstallDeepSearchToolkitAdapterInput = {
  afterUpdate?: () => void
  createState: CatchToolkitStateFactory
  getHostState: () => CatchToolkitHostState
  hostProbe: CatchToolkitHostProbe
  scope: Record<string, unknown>
  selectorScope?: CatchToolkitSelectorScope
  storage?: CatchToolkitStorage
  syncHostPreferences: (state: CatchToolkitState) => void
}

/**
 * Makes the target toolkit state the preference owner while the target MSE
 * page adapter consumes a synchronized runtime projection.
 */
export function installDeepSearchToolkitAdapter(
  input: InstallDeepSearchToolkitAdapterInput,
): DeepSearchToolkitAdapter {
  const adapterSentinel = '__OMNIFLOW_DEEP_SEARCH_TOOLKIT_ADAPTER_V1__'
  const current = input.scope[adapterSentinel] as DeepSearchToolkitAdapter | undefined
  if (current && !current.isDisposed()) return current

  const owner = input.createState({
    selectorScope: input.selectorScope,
    storage: input.storage,
  })
  const previousGetState = input.hostProbe.getCatchToolkitState
  const previousUpdateState = input.hostProbe.updateCatchToolkitState
  let disposed = false

  const syncState = () => {
    const state = owner.getState()
    input.syncHostPreferences(state)
    return state
  }
  const getCatchToolkitState = () => {
    syncState()
    return input.getHostState()
  }
  const updateCatchToolkitState = (payload: Partial<CatchToolkitPreferences>) => {
    const state = owner.update(payload)
    input.syncHostPreferences(state)
    input.afterUpdate?.()
    return input.getHostState()
  }

  syncState()
  input.hostProbe.getCatchToolkitState = getCatchToolkitState
  input.hostProbe.updateCatchToolkitState = updateCatchToolkitState

  const adapter: DeepSearchToolkitAdapter = {
    dispose() {
      if (disposed) return
      disposed = true
      if (input.hostProbe.getCatchToolkitState === getCatchToolkitState) {
        input.hostProbe.getCatchToolkitState = previousGetState
      }
      if (input.hostProbe.updateCatchToolkitState === updateCatchToolkitState) {
        input.hostProbe.updateCatchToolkitState = previousUpdateState
      }
      if (input.scope[adapterSentinel] === adapter) delete input.scope[adapterSentinel]
    },
    getState: owner.getState,
    isDisposed: () => disposed,
  }
  Object.defineProperty(input.scope, adapterSentinel, {
    configurable: true,
    value: adapter,
  })
  return adapter
}

export function createDeepSearchToolkitAdapterBodySource() {
  return [
    `const createCatchToolkitState = ${createCatchToolkitStateSource()};`,
    `const installDeepSearchToolkitAdapter = (${installDeepSearchToolkitAdapter.toString()});`,
    'installDeepSearchToolkitAdapter({',
    '  afterUpdate: () => { if (!isWorkerScope) msePageAdapter.ensureTrackedMediaObserver(); },',
    '  createState: createCatchToolkitState,',
    '  getHostState: msePageAdapter.getState,',
    '  hostProbe: globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__,',
    '  scope: globalScope,',
    "  selectorScope: typeof document === 'undefined' ? undefined : document,",
    "  storage: typeof localStorage === 'undefined' ? undefined : localStorage,",
    '  syncHostPreferences: (state) => {',
    '    catchToolkitProjection.autoDownloadOnComplete = state.autoDownloadOnComplete;',
    '    catchToolkitProjection.autoSeekToBufferedEnd = state.autoSeekToBufferedEnd;',
    '    catchToolkitProjection.clearCacheOnComplete = state.clearCacheOnComplete;',
    '    catchToolkitProjection.manualFileName = state.manualFileName;',
    '    catchToolkitProjection.regexRule = state.regexRule;',
    '    catchToolkitProjection.regexWarning = state.regexWarning;',
    '    catchToolkitProjection.restartAlwaysFromBeginning = state.restartAlwaysFromBeginning;',
    '    catchToolkitProjection.saveEveryGigabyte = state.saveEveryGigabyte;',
    '    catchToolkitProjection.selectorRule = state.selectorRule;',
    '    catchToolkitProjection.selectorWarning = state.selectorWarning;',
    '    catchToolkitProjection.trimExtraMediaHeaders = state.trimExtraMediaHeaders;',
    '  },',
    '});',
  ].join('\n')
}
