import { getResourceExtension } from './embeddedBrowserResourceClassifier'
import type {
  EmbeddedBrowserCapturedResource,
  EmbeddedBrowserCapturedResourceSource,
  EmbeddedBrowserResourceCaptureSnapshot,
} from './embeddedBrowserResourceTypes'

type EmbeddedBrowserTabCaptureState = {
  deepCaptureEnabled: boolean
  enabled: boolean
  resources: Map<string, EmbeddedBrowserCapturedResource>
}

const tabCaptureStates = new Map<string, EmbeddedBrowserTabCaptureState>()
let emitCapturedResource: ((payload: EmbeddedBrowserCapturedResource) => void) | null = null

function createEmptyState(): EmbeddedBrowserTabCaptureState {
  return {
    deepCaptureEnabled: false,
    enabled: false,
    resources: new Map<string, EmbeddedBrowserCapturedResource>(),
  }
}

function getOrCreateTabCaptureState(tabId: string) {
  const normalizedTabId = String(tabId || '').trim()
  if (!normalizedTabId) {
    return null
  }
  const existingState = tabCaptureStates.get(normalizedTabId)
  if (existingState) {
    return existingState
  }
  const nextState = createEmptyState()
  tabCaptureStates.set(normalizedTabId, nextState)
  return nextState
}

export function getEmbeddedBrowserTabCaptureState(tabId: string) {
  const normalizedTabId = String(tabId || '').trim()
  if (!normalizedTabId) {
    return null
  }
  return tabCaptureStates.get(normalizedTabId) || null
}

function buildResourceKey(
  tabId: string,
  source: EmbeddedBrowserCapturedResourceSource,
  url: string,
  resourceKey?: string,
) {
  if (resourceKey) {
    return `${tabId}::${source}::${resourceKey}`
  }
  return `${tabId}::${source}::${url}`
}

function buildResourceId(
  tabId: string,
  source: EmbeddedBrowserCapturedResourceSource,
  url: string,
  resourceKey?: string,
) {
  return buildResourceKey(tabId, source, url, resourceKey)
}

function toSortedResourceList(resources: Map<string, EmbeddedBrowserCapturedResource>) {
  return Array.from(resources.values()).sort((left, right) => right.capturedAt - left.capturedAt)
}

function createSnapshotFromState(state: EmbeddedBrowserTabCaptureState): EmbeddedBrowserResourceCaptureSnapshot {
  return {
    deepCaptureEnabled: state.deepCaptureEnabled,
    enabled: state.enabled,
    resources: toSortedResourceList(state.resources),
  }
}

export function setEmbeddedBrowserCapturedResourceEmitter(
  emitter: (payload: EmbeddedBrowserCapturedResource) => void,
) {
  emitCapturedResource = emitter
}

export function updateEmbeddedBrowserCapturedResource(
  tabId: string,
  input: Omit<EmbeddedBrowserCapturedResource, 'id' | 'tabId'>,
) {
  const state = getEmbeddedBrowserTabCaptureState(tabId)
  if (!state?.enabled) {
    return null
  }
  const normalizedUrl = String(input.url || '').trim()
  if (!normalizedUrl) {
    return null
  }
  const stableResourceKey = String(input.resourceKey || '').trim() || undefined
  const storageKey = buildResourceKey(tabId, input.source, normalizedUrl, stableResourceKey)
  const previousResource = state.resources.get(storageKey)
  const nextResource: EmbeddedBrowserCapturedResource = {
    ...previousResource,
    ...input,
    ext: input.ext || previousResource?.ext || getResourceExtension(normalizedUrl) || undefined,
    id: buildResourceId(tabId, input.source, normalizedUrl, stableResourceKey),
    kind: input.kind,
    resourceKey: stableResourceKey,
    tabId,
    url: normalizedUrl,
  }
  const changed = JSON.stringify(previousResource) !== JSON.stringify(nextResource)
  if (!changed) {
    return previousResource || null
  }
  state.resources.set(storageKey, nextResource)
  emitCapturedResource?.(nextResource)
  return nextResource
}

export function getEmbeddedBrowserResourceCaptureSnapshot(tabId: string): EmbeddedBrowserResourceCaptureSnapshot {
  const state = getEmbeddedBrowserTabCaptureState(tabId)
  return state ? createSnapshotFromState(state) : createSnapshotFromState(createEmptyState())
}

export function startEmbeddedBrowserResourceCapture(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.enabled = true
  return createSnapshotFromState(state)
}

export function startEmbeddedBrowserDeepResourceCapture(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.enabled = true
  state.deepCaptureEnabled = true
  return createSnapshotFromState(state)
}

export function stopEmbeddedBrowserResourceCapture(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.enabled = false
  state.deepCaptureEnabled = false
  return createSnapshotFromState(state)
}

export function clearEmbeddedBrowserCapturedResources(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.resources.clear()
  return createSnapshotFromState(state)
}

export function disposeEmbeddedBrowserCapturedResources(tabId: string) {
  tabCaptureStates.delete(String(tabId || '').trim())
}

export function isEmbeddedBrowserDeepCaptureEnabled(tabId: string) {
  return Boolean(getEmbeddedBrowserTabCaptureState(tabId)?.deepCaptureEnabled)
}
