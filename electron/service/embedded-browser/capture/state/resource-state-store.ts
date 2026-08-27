import crypto from 'node:crypto'

import { classifyResourceFingerprint } from '../../cat-catch-port/network/classifier'
import {
  CAPTURE_MODES,
  CAPTURED_RESOURCE_KINDS,
  type ActiveResourceStateSnapshot,
  type CaptureMode,
  type CapturedResourceContextProjection,
  type CapturedResourceKind,
  type CapturedResourceProjection,
  type CapturedResourceSource,
  type CapturedResourceStreamType,
  type DisposedResourceStateSnapshot,
  type ResourceStateActiveResetCause,
  type ResourceStateChange,
  type ResourceStateDisposeCause,
  type ResourceStateModeChange,
  type ResourceStateRemoveChange,
  type ResourceStateResetChange,
  type ResourceStateSnapshot,
  type ResourceStateStamp,
  type ResourceStateUpsertChange,
} from '../../contracts/captured-resource'
import type { NetworkContextProjection } from './network-context-vault'

export {
  CAPTURE_MODES,
  CAPTURED_RESOURCE_KINDS,
  type ActiveResourceStateSnapshot,
  type CaptureMode,
  type CapturedResourceContextProjection,
  type CapturedResourceKind,
  type CapturedResourceProjection,
  type CapturedResourceSource,
  type CapturedResourceStreamType,
  type DisposedResourceStateSnapshot,
  type ResourceStateActiveResetCause,
  type ResourceStateChange,
  type ResourceStateDisposeCause,
  type ResourceStateModeChange,
  type ResourceStateRemoveChange,
  type ResourceStateResetChange,
  type ResourceStateSnapshot,
  type ResourceStateStamp,
  type ResourceStateUpsertChange,
} from '../../contracts/captured-resource'

const DEFAULT_MAX_RESOURCES_PER_TAB = 10_000
const DEFAULT_RESOURCE_TTL_MS = 6 * 60 * 60_000

export type CapturedResourceMetadataInput = {
  capturedAt?: number
  contentLength?: number
  ext?: string
  kind: CapturedResourceKind
  method?: string
  mimeType?: string
  name?: string
  resourceKey?: string
  resourceType?: string
  statusCode?: number
  streamType?: CapturedResourceStreamType
  url: string
}

export type OwnedCapturedResource = CapturedResourceProjection & {
  capturedIncarnation: number
  capturedNavigationGeneration: number
  capturedPageOrigin: string | null
  capturedWebContentsId: number
  contextRef?: string
  resourceKey?: string
}

export type TabCaptureBinding = {
  incarnation: number
  navigationGeneration: number
  pageOrigin: string | null
  tabId: string
  webContentsId: number
}

export type ResourceWriteDecision =
  | 'accepted'
  | 'capacity-reset'
  | 'capture-disabled'
  | 'context-already-owned'
  | 'duplicate'
  | 'invalid'
  | 'stale-binding'

export type ResourceWriteResult = {
  change: ResourceStateChange | null
  decision: ResourceWriteDecision
  resource: CapturedResourceProjection | null
}

export type RegisterTabResult = {
  binding: TabCaptureBinding
  change: ResourceStateResetChange | null
}

export type NavigationCommitResult = {
  binding: TabCaptureBinding
  change: ResourceStateResetChange | null
}

export type ResourceStateStoreOptions = {
  createResourceId?: () => string
  maxResourcesPerTab?: number
  now?: () => number
  releaseContext?: (contextRef: string) => unknown
  resourceTtlMs?: number
}

type NormalizedResourceMetadata = {
  capturedAt: number
  contentLength?: number
  ext?: string
  kind: CapturedResourceKind
  method?: string
  mimeType?: string
  name?: string
  resourceKey?: string
  resourceType?: string
  source: CapturedResourceSource
  statusCode?: number
  streamType?: CapturedResourceStreamType
  url: string
}

type StoredResource = NormalizedResourceMetadata & {
  capturedIncarnation: number
  capturedNavigationGeneration: number
  capturedPageOrigin: string | null
  capturedWebContentsId: number
  context?: NetworkContextProjection
  expiresAt: number
  fingerprintEpoch?: number
  id: string
  sequence: number
  tabId: string
}

type TabOwnerState = {
  captureMode: CaptureMode
  fingerprintEpoch: number
  fingerprints: Set<string>
  incarnation: number
  navigationGeneration: number
  pageOrigin: string | null
  resources: Map<string, StoredResource>
  revision: number
  stableProbeIds: Map<string, string>
  tabId: string
  webContentsId: number
}

type ContextOwner = {
  resourceId: string
  tabId: string
}

const captureModeSet = new Set<CaptureMode>(CAPTURE_MODES)
const capturedResourceKindSet = new Set<CapturedResourceKind>(CAPTURED_RESOURCE_KINDS)
const capturedResourceStreamTypeSet = new Set<CapturedResourceStreamType>(['audio', 'video'])

function normalizePositiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeTabId(value: unknown) {
  const tabId = String(value ?? '').trim()
  return tabId || null
}

function normalizeWebContentsId(value: unknown) {
  const webContentsId = Number(value)
  return Number.isInteger(webContentsId) && webContentsId > 0 ? webContentsId : null
}

function normalizeNonNegativeInteger(value: unknown) {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null
}

function normalizePositiveIntegerValue(value: unknown) {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null
}

function normalizeOptionalString(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function normalizePageOrigin(value: unknown) {
  const rawUrl = String(value ?? '').trim()
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function normalizeCaptureMode(value: unknown) {
  const mode = String(value || '') as CaptureMode
  return captureModeSet.has(mode) ? mode : null
}

function normalizeResourceMetadata(
  input: CapturedResourceMetadataInput,
  source: CapturedResourceSource,
  now: number,
): NormalizedResourceMetadata | null {
  const url = String(input?.url ?? '').trim()
  const kind = String(input?.kind ?? '') as CapturedResourceKind
  if (!url || !capturedResourceKindSet.has(kind)) return null

  const capturedAtValue = Number(input.capturedAt)
  const capturedAt = Number.isFinite(capturedAtValue) && capturedAtValue >= 0
    ? capturedAtValue
    : now
  const contentLengthValue = Number(input.contentLength)
  const contentLength = Number.isFinite(contentLengthValue) && contentLengthValue >= 0
    ? contentLengthValue
    : undefined
  const statusCodeValue = Number(input.statusCode)
  const statusCode = Number.isInteger(statusCodeValue) && statusCodeValue >= 0
    ? statusCodeValue
    : undefined
  const normalizedStreamType = String(input.streamType || '') as CapturedResourceStreamType
  const streamType = capturedResourceStreamTypeSet.has(normalizedStreamType)
    ? normalizedStreamType
    : undefined
  const ext = normalizeOptionalString(input.ext)?.replace(/^\./, '').toLowerCase()

  return {
    capturedAt,
    contentLength,
    ext,
    kind,
    method: normalizeOptionalString(input.method)?.toUpperCase(),
    mimeType: normalizeOptionalString(input.mimeType)?.toLowerCase(),
    name: normalizeOptionalString(input.name),
    resourceKey: normalizeOptionalString(input.resourceKey),
    resourceType: normalizeOptionalString(input.resourceType)?.toLowerCase(),
    source,
    statusCode,
    streamType,
    url,
  }
}

function normalizeNetworkContext(
  input: NetworkContextProjection | null | undefined,
): NetworkContextProjection | undefined {
  if (!input) return undefined
  const contextRef = String(input.contextRef || '').trim()
  if (!contextRef) return undefined
  const headerNames = Array.from(new Set(
    (Array.isArray(input.headerNames) ? input.headerNames : [])
      .map(name => String(name || '').trim().toLowerCase())
      .filter(Boolean),
  ))
  return {
    capabilities: {
      hasAuthorization: Boolean(input.capabilities?.hasAuthorization),
      hasCookie: Boolean(input.capabilities?.hasCookie),
    },
    contextRef,
    headerNames,
  }
}

function cloneContextProjection(
  context: NetworkContextProjection | undefined,
): NetworkContextProjection | undefined {
  if (!context) return undefined
  return {
    capabilities: { ...context.capabilities },
    contextRef: context.contextRef,
    headerNames: [...context.headerNames],
  }
}

function projectContext(
  context: NetworkContextProjection | undefined,
): CapturedResourceContextProjection | undefined {
  if (!context) return undefined
  return {
    hasAuthorization: context.capabilities.hasAuthorization,
    hasCookie: context.capabilities.hasCookie,
    headerNames: [...context.headerNames],
  }
}

function projectResource(resource: StoredResource): CapturedResourceProjection {
  return {
    capturedAt: resource.capturedAt,
    contentLength: resource.contentLength,
    context: projectContext(resource.context),
    ext: resource.ext,
    id: resource.id,
    kind: resource.kind,
    method: resource.method,
    mimeType: resource.mimeType,
    name: resource.name,
    resourceType: resource.resourceType,
    source: resource.source,
    statusCode: resource.statusCode,
    streamType: resource.streamType,
    tabId: resource.tabId,
    url: resource.url,
  }
}

function cloneOwnedResource(resource: StoredResource): OwnedCapturedResource {
  return {
    ...projectResource(resource),
    capturedIncarnation: resource.capturedIncarnation,
    capturedNavigationGeneration: resource.capturedNavigationGeneration,
    capturedPageOrigin: resource.capturedPageOrigin,
    capturedWebContentsId: resource.capturedWebContentsId,
    contextRef: resource.context?.contextRef,
    resourceKey: resource.resourceKey,
  }
}

function storedMetadata(resource: StoredResource): NormalizedResourceMetadata {
  return {
    capturedAt: resource.capturedAt,
    contentLength: resource.contentLength,
    ext: resource.ext,
    kind: resource.kind,
    method: resource.method,
    mimeType: resource.mimeType,
    name: resource.name,
    resourceKey: resource.resourceKey,
    resourceType: resource.resourceType,
    source: resource.source,
    statusCode: resource.statusCode,
    streamType: resource.streamType,
    url: resource.url,
  }
}

function mergeStableMetadata(
  previous: NormalizedResourceMetadata,
  next: NormalizedResourceMetadata,
): NormalizedResourceMetadata {
  return {
    capturedAt: next.capturedAt,
    contentLength: next.contentLength ?? previous.contentLength,
    ext: next.ext ?? previous.ext,
    kind: next.kind,
    method: next.method ?? previous.method,
    mimeType: next.mimeType ?? previous.mimeType,
    name: next.name ?? previous.name,
    resourceKey: next.resourceKey ?? previous.resourceKey,
    resourceType: next.resourceType ?? previous.resourceType,
    source: next.source,
    statusCode: next.statusCode ?? previous.statusCode,
    streamType: next.streamType ?? previous.streamType,
    url: next.url,
  }
}

function buildStableProbeKey(navigationGeneration: number, resourceKey: string) {
  return `probe\u0000${navigationGeneration}\u0000${resourceKey}`
}

export class ResourceStateStore {
  private readonly contextOwners = new Map<string, ContextOwner>()
  private readonly createResourceId: () => string
  private incarnationSequence = 0
  private readonly maxResourcesPerTab: number
  private readonly now: () => number
  private readonly releaseContext: (contextRef: string) => unknown
  private readonly resourceIds = new Set<string>()
  private readonly resourceTtlMs: number
  private resourceSequence = 0
  private readonly tabs = new Map<string, TabOwnerState>()
  private readonly tombstones = new Map<string, DisposedResourceStateSnapshot>()

  constructor(options: ResourceStateStoreOptions = {}) {
    this.createResourceId = options.createResourceId
      || (() => crypto.randomBytes(18).toString('base64url'))
    this.maxResourcesPerTab = normalizePositiveInteger(
      options.maxResourcesPerTab,
      DEFAULT_MAX_RESOURCES_PER_TAB,
    )
    this.now = options.now || Date.now
    this.releaseContext = options.releaseContext || (() => {})
    this.resourceTtlMs = normalizePositiveNumber(
      options.resourceTtlMs,
      DEFAULT_RESOURCE_TTL_MS,
    )
  }

  registerTab(input: { pageUrl?: string; tabId: string; webContentsId: number }): RegisterTabResult | null {
    const tabId = normalizeTabId(input.tabId)
    const webContentsId = normalizeWebContentsId(input.webContentsId)
    if (!tabId || webContentsId === null) return null

    const existing = this.tabs.get(tabId)
    if (existing?.webContentsId === webContentsId) {
      return { binding: this.toBinding(existing), change: null }
    }

    const cause: ResourceStateActiveResetCause = existing ? 'replace' : 'register'
    const previousRevision = existing?.revision || this.tombstones.get(tabId)?.revision || 0
    if (existing) this.clearStateResources(existing)

    const state: TabOwnerState = {
      captureMode: 'off',
      fingerprintEpoch: 0,
      fingerprints: new Set<string>(),
      incarnation: ++this.incarnationSequence,
      navigationGeneration: 0,
      pageOrigin: normalizePageOrigin(input.pageUrl),
      resources: new Map<string, StoredResource>(),
      revision: previousRevision + 1,
      stableProbeIds: new Map<string, string>(),
      tabId,
      webContentsId,
    }
    this.tabs.set(tabId, state)
    this.tombstones.delete(tabId)
    return {
      binding: this.toBinding(state),
      change: this.activeResetChange(state, cause),
    }
  }

  getCaptureBinding(tabId: string) {
    const state = this.getTab(tabId)
    return state ? this.toBinding(state) : null
  }

  getSnapshot(tabId: string): ResourceStateSnapshot | null {
    const normalizedTabId = normalizeTabId(tabId)
    if (!normalizedTabId) return null
    const state = this.tabs.get(normalizedTabId)
    if (state) return this.snapshotState(state)
    const tombstone = this.tombstones.get(normalizedTabId)
    return tombstone ? { ...tombstone } : null
  }

  setCaptureMode(tabId: string, captureMode: CaptureMode): ResourceStateModeChange | null {
    const state = this.getTab(tabId)
    const normalizedMode = normalizeCaptureMode(captureMode)
    if (!state || !normalizedMode) return null
    state.captureMode = normalizedMode
    this.bumpRevision(state)
    return {
      ...this.toStamp(state),
      captureMode: normalizedMode,
      type: 'mode',
    }
  }

  commitNavigation(input: {
    binding: TabCaptureBinding
    clearResources?: boolean
    pageUrl: string
  }): NavigationCommitResult | null {
    const state = this.getCurrentState(input.binding)
    const pageUrl = String(input.pageUrl || '').trim()
    if (!state || !pageUrl) return null

    let change: ResourceStateResetChange | null = null
    if (input.clearResources !== false) this.clearStateResources(state)
    state.navigationGeneration += 1
    state.pageOrigin = normalizePageOrigin(pageUrl)
    if (input.clearResources !== false) {
      this.bumpRevision(state)
      change = this.activeResetChange(state, 'navigation')
    }
    return { binding: this.toBinding(state), change }
  }

  recordNetworkResource(
    input: {
      binding: TabCaptureBinding
      context?: NetworkContextProjection
      metadata: CapturedResourceMetadataInput
    },
    options: { checkDuplicates?: boolean } = {},
  ): ResourceWriteResult {
    const state = this.getCurrentState(input.binding)
    if (!state) return this.rejectWrite('stale-binding', input.context)
    if (state.captureMode === 'off') return this.rejectWrite('capture-disabled', input.context)
    const now = this.now()
    const metadata = normalizeResourceMetadata(input.metadata, 'network', now)
    if (!metadata) return this.rejectWrite('invalid', input.context)
    const context = normalizeNetworkContext(input.context)
    if (context && this.contextOwners.has(context.contextRef)) {
      return { change: null, decision: 'context-already-owned', resource: null }
    }

    const capacityChange = this.resetAtCapacity(state, context)
    if (capacityChange) {
      return { change: capacityChange, decision: 'capacity-reset', resource: null }
    }

    const fingerprintDecision = classifyResourceFingerprint({
      capturedResourceCount: state.resources.size,
      checkDuplicates: options.checkDuplicates,
      fingerprints: state.fingerprints,
      url: metadata.url,
    })
    if (fingerprintDecision.decision === 'duplicate') {
      return this.rejectWrite('duplicate', context)
    }

    const fingerprintEpoch = fingerprintDecision.effect === 'record'
      ? state.fingerprintEpoch
      : undefined
    let resource: StoredResource
    try {
      resource = this.createStoredResource(state, metadata, {
        context,
        fingerprintEpoch,
        now,
      })
    } catch (error) {
      this.releaseInputContext(context)
      throw error
    }

    if (fingerprintDecision.effect === 'record') {
      state.fingerprints.add(fingerprintDecision.fingerprint)
    } else if (fingerprintDecision.effect === 'record-then-reset') {
      state.fingerprints.add(fingerprintDecision.fingerprint)
      state.fingerprints.clear()
      state.fingerprintEpoch += 1
    }

    this.addStoredResource(state, resource)
    this.claimContext(resource)
    this.bumpRevision(state)
    return {
      change: this.upsertChange(state, [resource]),
      decision: 'accepted',
      resource: projectResource(resource),
    }
  }

  upsertProbeResource(input: {
    binding: TabCaptureBinding
    metadata: CapturedResourceMetadataInput
  }): ResourceWriteResult {
    const state = this.getCurrentState(input.binding)
    if (!state) return { change: null, decision: 'stale-binding', resource: null }
    if (state.captureMode !== 'deep') {
      return { change: null, decision: 'capture-disabled', resource: null }
    }
    const now = this.now()
    const metadata = normalizeResourceMetadata(input.metadata, 'probe', now)
    if (!metadata?.resourceKey) {
      return { change: null, decision: 'invalid', resource: null }
    }

    const stableKey = buildStableProbeKey(state.navigationGeneration, metadata.resourceKey)
    const existingId = state.stableProbeIds.get(stableKey)
    const existing = existingId ? state.resources.get(existingId) : undefined
    if (existing) {
      const mergedMetadata = mergeStableMetadata(storedMetadata(existing), metadata)
      const updated: StoredResource = {
        ...existing,
        ...mergedMetadata,
        capturedIncarnation: state.incarnation,
        capturedNavigationGeneration: state.navigationGeneration,
        capturedPageOrigin: state.pageOrigin,
        capturedWebContentsId: state.webContentsId,
        expiresAt: now + this.resourceTtlMs,
        sequence: ++this.resourceSequence,
      }
      state.resources.set(existing.id, updated)
      this.bumpRevision(state)
      return {
        change: this.upsertChange(state, [updated]),
        decision: 'accepted',
        resource: projectResource(updated),
      }
    }

    const capacityChange = this.resetAtCapacity(state)
    if (capacityChange) {
      return { change: capacityChange, decision: 'capacity-reset', resource: null }
    }

    const resource = this.createStoredResource(state, metadata, { now })
    this.addStoredResource(state, resource)
    state.stableProbeIds.set(stableKey, resource.id)
    this.bumpRevision(state)
    return {
      change: this.upsertChange(state, [resource]),
      decision: 'accepted',
      resource: projectResource(resource),
    }
  }

  getOwnedResource(tabId: string, resourceId: string) {
    const state = this.getTab(tabId)
    const normalizedResourceId = String(resourceId || '').trim()
    if (!state || !normalizedResourceId) return null
    const resource = state.resources.get(normalizedResourceId)
    if (!resource || resource.expiresAt <= this.now()) return null
    return cloneOwnedResource(resource)
  }

  /** Transitional lookup for legacy page-toolkit keys during renderer cutover. */
  getOwnedResourceByResourceKey(tabId: string, resourceKey: string) {
    const state = this.getTab(tabId)
    const normalizedResourceKey = String(resourceKey || '').trim()
    if (!state || !normalizedResourceKey) return null
    const resource = Array.from(state.resources.values()).find(item => (
      item.resourceKey === normalizedResourceKey && item.expiresAt > this.now()
    ))
    return resource ? cloneOwnedResource(resource) : null
  }

  invalidateContext(contextRef: string): ResourceStateUpsertChange[] {
    const normalizedContextRef = String(contextRef || '').trim()
    if (!normalizedContextRef) return []
    const owner = this.contextOwners.get(normalizedContextRef)
    if (!owner) return []
    const state = this.tabs.get(owner.tabId)
    const resource = state?.resources.get(owner.resourceId)
    this.contextOwners.delete(normalizedContextRef)
    if (!state || resource?.context?.contextRef !== normalizedContextRef) return []
    resource.context = undefined
    this.bumpRevision(state)
    return [this.upsertChange(state, [resource])]
  }

  clearResources(tabId: string): ResourceStateResetChange | null {
    const state = this.getTab(tabId)
    if (!state) return null
    this.clearStateResources(state)
    this.bumpRevision(state)
    return this.activeResetChange(state, 'clear')
  }

  disposeTab(tabId: string) {
    const state = this.getTab(tabId)
    return state ? this.disposeState(state, 'tab-dispose') : null
  }

  disposeWebContents(webContentsId: number) {
    const normalizedWebContentsId = normalizeWebContentsId(webContentsId)
    if (normalizedWebContentsId === null) return []
    const changes: ResourceStateResetChange[] = []
    for (const state of Array.from(this.tabs.values())) {
      if (state.webContentsId !== normalizedWebContentsId) continue
      changes.push(this.disposeState(state, 'web-contents-dispose'))
    }
    return changes
  }

  sweepExpired() {
    const now = this.now()
    const changes: ResourceStateRemoveChange[] = []
    for (const state of this.tabs.values()) {
      const resourceIds: string[] = []
      for (const resource of Array.from(state.resources.values())) {
        if (resource.expiresAt > now) continue
        if (this.removeStoredResource(state, resource)) resourceIds.push(resource.id)
      }
      if (resourceIds.length === 0) continue
      this.bumpRevision(state)
      changes.push({
        ...this.toStamp(state),
        reason: 'ttl',
        resourceIds: [...resourceIds],
        type: 'remove',
      })
    }
    return changes
  }

  disposeAll() {
    return Array.from(this.tabs.values()).map(state => (
      this.disposeState(state, 'app-dispose')
    ))
  }

  private getTab(tabId: string) {
    const normalizedTabId = normalizeTabId(tabId)
    return normalizedTabId ? this.tabs.get(normalizedTabId) || null : null
  }

  private getCurrentState(binding: TabCaptureBinding) {
    const tabId = normalizeTabId(binding?.tabId)
    const webContentsId = normalizeWebContentsId(binding?.webContentsId)
    const incarnation = normalizePositiveIntegerValue(binding?.incarnation)
    const navigationGeneration = normalizeNonNegativeInteger(binding?.navigationGeneration)
    if (
      !tabId
      || webContentsId === null
      || incarnation === null
      || navigationGeneration === null
    ) {
      return null
    }
    const state = this.tabs.get(tabId)
    if (
      !state
      || state.webContentsId !== webContentsId
      || state.incarnation !== incarnation
      || state.navigationGeneration !== navigationGeneration
      || state.pageOrigin !== normalizePageOrigin(binding.pageOrigin)
    ) {
      return null
    }
    return state
  }

  private toBinding(state: TabOwnerState): TabCaptureBinding {
    return {
      incarnation: state.incarnation,
      navigationGeneration: state.navigationGeneration,
      pageOrigin: state.pageOrigin,
      tabId: state.tabId,
      webContentsId: state.webContentsId,
    }
  }

  private toStamp(state: TabOwnerState): ResourceStateStamp {
    return {
      incarnation: state.incarnation,
      revision: state.revision,
      tabId: state.tabId,
    }
  }

  private bumpRevision(state: TabOwnerState) {
    state.revision += 1
  }

  private activeResetChange(
    state: TabOwnerState,
    cause: ResourceStateActiveResetCause,
  ): ResourceStateResetChange {
    return {
      ...this.toStamp(state),
      captureMode: state.captureMode,
      cause,
      status: 'active',
      type: 'reset',
    }
  }

  private upsertChange(
    state: TabOwnerState,
    resources: readonly StoredResource[],
  ): ResourceStateUpsertChange {
    return {
      ...this.toStamp(state),
      resources: resources.map(projectResource),
      type: 'upsert',
    }
  }

  private snapshotState(state: TabOwnerState): ActiveResourceStateSnapshot {
    const resources = Array.from(state.resources.values())
      .sort((left, right) => (
        right.capturedAt - left.capturedAt || right.sequence - left.sequence
      ))
      .map(projectResource)
    return {
      ...this.toStamp(state),
      captureMode: state.captureMode,
      resources,
      status: 'active',
    }
  }

  private createStoredResource(
    state: TabOwnerState,
    metadata: NormalizedResourceMetadata,
    input: {
      context?: NetworkContextProjection
      fingerprintEpoch?: number
      now: number
    },
  ): StoredResource {
    return {
      ...metadata,
      capturedIncarnation: state.incarnation,
      capturedNavigationGeneration: state.navigationGeneration,
      capturedPageOrigin: state.pageOrigin,
      capturedWebContentsId: state.webContentsId,
      context: cloneContextProjection(input.context),
      expiresAt: input.now + this.resourceTtlMs,
      fingerprintEpoch: input.fingerprintEpoch,
      id: this.createUniqueResourceId(),
      sequence: ++this.resourceSequence,
      tabId: state.tabId,
    }
  }

  private createUniqueResourceId() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const resourceId = String(this.createResourceId() || '').trim()
      if (resourceId && !this.resourceIds.has(resourceId)) return resourceId
    }
    throw new Error('Unable to allocate a unique captured resource id')
  }

  private addStoredResource(state: TabOwnerState, resource: StoredResource) {
    state.resources.set(resource.id, resource)
    this.resourceIds.add(resource.id)
  }

  private claimContext(resource: StoredResource) {
    const contextRef = resource.context?.contextRef
    if (!contextRef) return
    this.contextOwners.set(contextRef, {
      resourceId: resource.id,
      tabId: resource.tabId,
    })
  }

  /**
   * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
   * Source: js/init.js#maxLength / js/background.js#cacheData length guard
   * Reason: The desktop default retains 10,000 entries, then resets the tab and drops the next candidate.
   * Adaptation: Reset also releases main-only context references; the limit is injectable for tests.
   * Fixture: none; covered by state.capacity-ttl-dedupe.
   */
  private resetAtCapacity(
    state: TabOwnerState,
    candidateContext?: NetworkContextProjection,
  ) {
    if (state.resources.size < this.maxResourcesPerTab) return null
    this.clearStateResources(state)
    this.releaseInputContext(candidateContext)
    this.bumpRevision(state)
    return this.activeResetChange(state, 'capacity')
  }

  private rejectWrite(
    decision: Exclude<ResourceWriteDecision, 'accepted' | 'capacity-reset'>,
    context?: NetworkContextProjection,
  ): ResourceWriteResult {
    this.releaseInputContext(context)
    return { change: null, decision, resource: null }
  }

  private releaseInputContext(context?: NetworkContextProjection) {
    const contextRef = String(context?.contextRef || '').trim()
    if (!contextRef || this.contextOwners.has(contextRef)) return
    this.releaseContext(contextRef)
  }

  private releaseContextRefs(contextRefs: readonly string[]) {
    let firstError: unknown
    for (const contextRef of contextRefs) {
      try {
        this.releaseContext(contextRef)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }

  private removeStoredResource(state: TabOwnerState, resource: StoredResource) {
    if (!state.resources.delete(resource.id)) return false
    this.resourceIds.delete(resource.id)
    if (resource.resourceKey) {
      const stableKey = buildStableProbeKey(
        resource.capturedNavigationGeneration,
        resource.resourceKey,
      )
      if (state.stableProbeIds.get(stableKey) === resource.id) {
        state.stableProbeIds.delete(stableKey)
      }
    }
    if (resource.fingerprintEpoch === state.fingerprintEpoch) {
      state.fingerprints.delete(resource.url)
    }
    const contextRef = resource.context?.contextRef
    if (contextRef) {
      const owner = this.contextOwners.get(contextRef)
      if (owner?.resourceId === resource.id && owner.tabId === state.tabId) {
        this.contextOwners.delete(contextRef)
        this.releaseContextRefs([contextRef])
      }
    }
    return true
  }

  private clearStateResources(state: TabOwnerState) {
    const contextRefs: string[] = []
    for (const resource of state.resources.values()) {
      this.resourceIds.delete(resource.id)
      const contextRef = resource.context?.contextRef
      if (!contextRef) continue
      const owner = this.contextOwners.get(contextRef)
      if (owner?.resourceId !== resource.id || owner.tabId !== state.tabId) continue
      this.contextOwners.delete(contextRef)
      contextRefs.push(contextRef)
    }
    state.resources.clear()
    state.fingerprints.clear()
    state.fingerprintEpoch += 1
    state.stableProbeIds.clear()
    this.releaseContextRefs(contextRefs)
  }

  private disposeState(
    state: TabOwnerState,
    cause: ResourceStateDisposeCause,
  ): ResourceStateResetChange {
    this.clearStateResources(state)
    this.bumpRevision(state)
    this.tabs.delete(state.tabId)
    const tombstone: DisposedResourceStateSnapshot = {
      ...this.toStamp(state),
      status: 'disposed',
    }
    this.tombstones.set(state.tabId, tombstone)
    return {
      ...this.toStamp(state),
      cause,
      status: 'disposed',
      type: 'reset',
    }
  }
}
