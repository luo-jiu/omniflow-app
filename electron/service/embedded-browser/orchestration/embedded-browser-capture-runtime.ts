import type { CatCatchCompiledRules } from '../cat-catch-port/network/rules'
import {
  ElectronNetworkCaptureAdapter,
  type ElectronNetworkCaptureAdapterOptions,
  type ElectronNetworkWebRequestRegistrar,
} from '../capture/adapters/electron-network'
import type { CompiledOmniFlowCaptureSettings } from '../capture/policy/omniflow-capture-policy'
import {
  ElectronPageProbeEventAdapter,
  type BoundPageProbeDocument,
  type ElectronPageProbeWebContents,
} from '../capture/adapters/electron-page-probe'
import {
  NetworkContextVault,
  type NetworkContextVaultOptions,
} from '../capture/state/network-context-vault'
import {
  ResourceStateStore,
  type CaptureMode,
  type ResourceStateStoreOptions,
  type TabCaptureBinding,
} from '../capture/state/resource-state-store'
import type { ResourceStateChange, ResourceStateSnapshot } from '../contracts/captured-resource'
import {
  CapturedResourceAccessService,
  type CapturedResourceFetch,
} from '../integrations/captured-resource-access'
import { CapturedResourceInspectionService } from '../integrations/captured-resource-inspection'
import {
  EmbeddedBrowserLifecycle,
  type EmbeddedBrowserLifecycleWebContents,
} from '../shell/embedded-browser-lifecycle'

export type EmbeddedBrowserCaptureWebContents =
  EmbeddedBrowserLifecycleWebContents
  & ElectronPageProbeWebContents

export type RegisterEmbeddedBrowserCaptureViewInput = {
  clearResourcesOnNavigation?: boolean
  pageUrl?: string
  tabId: string
  webContents: EmbeddedBrowserCaptureWebContents
}

export type EmbeddedBrowserCaptureRuntimeOptions = {
  captureSettings?: CompiledOmniFlowCaptureSettings
  createDocumentToken?: () => string
  emitChange: (change: ResourceStateChange) => void
  fetch: CapturedResourceFetch
  maxPendingEvents?: number
  networkContextOptions?: NetworkContextVaultOptions
  onProbeControlPayload?: (tabId: string, payload: Record<string, unknown>) => void
  onProbeError?: (tabId: string, error: unknown) => void
  pageUrlPolicy?: ElectronNetworkCaptureAdapterOptions['pageUrlPolicy']
  resourceStateOptions?: Omit<ResourceStateStoreOptions, 'releaseContext'>
  rules?: CatCatchCompiledRules
  webRequest: ElectronNetworkWebRequestRegistrar
}

type ProbeRegistration = {
  adapter: ElectronPageProbeEventAdapter
  destroyedListener: () => void
  tabId: string
  webContents: EmbeddedBrowserCaptureWebContents
}

function normalizeTabId(value: unknown) {
  const tabId = String(value ?? '').trim()
  return tabId || null
}

function normalizeWebContentsId(value: unknown) {
  const webContentsId = Number(value)
  return Number.isInteger(webContentsId) && webContentsId > 0 ? webContentsId : null
}

/**
 * Main-only composition root for the network-capture unit. Constructing this
 * runtime claims the embedded browser session's webRequest listeners, so it
 * must only be created at the production cutover boundary.
 */
export class EmbeddedBrowserCaptureRuntime {
  readonly access: CapturedResourceAccessService
  readonly inspection: CapturedResourceInspectionService

  private disposed = false
  private readonly lifecycle: EmbeddedBrowserLifecycle
  private readonly networkAdapter: ElectronNetworkCaptureAdapter
  private readonly options: EmbeddedBrowserCaptureRuntimeOptions
  private readonly probeRegistrationsByTabId = new Map<string, ProbeRegistration>()
  private readonly probeRegistrationsByWebContentsId = new Map<number, ProbeRegistration>()
  private readonly store: ResourceStateStore
  private readonly vault: NetworkContextVault

  constructor(options: EmbeddedBrowserCaptureRuntimeOptions) {
    this.options = options
    this.vault = new NetworkContextVault(options.networkContextOptions)
    this.store = new ResourceStateStore({
      ...options.resourceStateOptions,
      releaseContext: contextRef => this.vault.release(contextRef),
    })
    this.lifecycle = new EmbeddedBrowserLifecycle({
      emitChange: options.emitChange,
      store: this.store,
      vault: this.vault,
    })

    this.networkAdapter = new ElectronNetworkCaptureAdapter({
      captureSettings: options.captureSettings,
      emitChange: options.emitChange,
      maxPendingEvents: options.maxPendingEvents,
      pageUrlPolicy: options.pageUrlPolicy,
      resolveBindingByWebContentsId: webContentsId => (
        this.lifecycle.resolveBindingByWebContentsId(webContentsId)
      ),
      resolvePageUrlByWebContentsId: webContentsId => (
        this.lifecycle.resolvePageUrlByWebContentsId(webContentsId)
      ),
      rules: options.rules,
      store: this.store,
      vault: this.vault,
      webRequest: options.webRequest,
    })
    this.lifecycle.attachNetworkAdapter(this.networkAdapter)

    this.access = new CapturedResourceAccessService({
      fetch: options.fetch,
      store: this.store,
      vault: this.vault,
    })
    this.inspection = new CapturedResourceInspectionService({ access: this.access })
  }

  registerView(input: RegisterEmbeddedBrowserCaptureViewInput): TabCaptureBinding | null {
    if (this.disposed) return null
    const binding = this.lifecycle.registerView(input)
    if (!binding) return null

    const existingForTab = this.probeRegistrationsByTabId.get(binding.tabId)
    if (existingForTab?.webContents.id === binding.webContentsId) return binding
    if (existingForTab) this.detachProbeRegistration(existingForTab)

    const existingForWebContents = this.probeRegistrationsByWebContentsId.get(
      binding.webContentsId,
    )
    if (existingForWebContents) this.detachProbeRegistration(existingForWebContents)

    let registration: ProbeRegistration | null = null
    const adapter = new ElectronPageProbeEventAdapter({
      createDocumentToken: this.options.createDocumentToken,
      lifecycle: this.lifecycle,
      onControlPayload: payload => this.options.onProbeControlPayload?.(binding.tabId, payload),
      onError: error => this.options.onProbeError?.(binding.tabId, error),
      tabId: binding.tabId,
      webContents: input.webContents,
    })
    const destroyedListener = () => {
      if (registration) this.detachProbeRegistration(registration)
    }
    registration = {
      adapter,
      destroyedListener,
      tabId: binding.tabId,
      webContents: input.webContents,
    }
    this.probeRegistrationsByTabId.set(binding.tabId, registration)
    this.probeRegistrationsByWebContentsId.set(binding.webContentsId, registration)
    input.webContents.once('destroyed', destroyedListener)
    return binding
  }

  bindProbeDocument(tabId: string): BoundPageProbeDocument | null {
    if (this.disposed) return null
    const normalizedTabId = normalizeTabId(tabId)
    if (!normalizedTabId) return null
    const snapshot = this.store.getSnapshot(normalizedTabId)
    if (snapshot?.status !== 'active' || snapshot.captureMode !== 'deep') return null
    return this.probeRegistrationsByTabId.get(normalizedTabId)?.adapter.bindCurrentDocument()
      || null
  }

  getSnapshot(tabId: string): ResourceStateSnapshot | null {
    if (this.disposed) return null
    return this.store.getSnapshot(tabId)
  }

  setCaptureMode(tabId: string, captureMode: CaptureMode) {
    if (this.disposed) return null
    return this.lifecycle.setCaptureMode(tabId, captureMode)
  }

  updateCaptureSettings(captureSettings: CompiledOmniFlowCaptureSettings) {
    if (this.disposed) return false
    return this.networkAdapter.updateCaptureSettings(captureSettings)
  }

  clearResources(tabId: string) {
    if (this.disposed) return null
    return this.lifecycle.clearResources(tabId)
  }

  closeTab(tabId: string) {
    if (this.disposed) return false
    const normalizedTabId = normalizeTabId(tabId)
    if (!normalizedTabId) return false
    const registration = this.probeRegistrationsByTabId.get(normalizedTabId)
    if (registration) this.detachProbeRegistration(registration)
    return this.lifecycle.closeTab(normalizedTabId)
  }

  disposeWebContents(webContentsId: number) {
    if (this.disposed) return false
    const normalizedWebContentsId = normalizeWebContentsId(webContentsId)
    if (normalizedWebContentsId === null) return false
    const registration = this.probeRegistrationsByWebContentsId.get(normalizedWebContentsId)
    if (registration) this.detachProbeRegistration(registration)
    return this.lifecycle.disposeWebContents(normalizedWebContentsId)
  }

  closeAll() {
    if (this.disposed) return 0
    for (const registration of Array.from(this.probeRegistrationsByTabId.values())) {
      this.detachProbeRegistration(registration)
    }
    return this.lifecycle.closeAll()
  }

  sweepExpired() {
    if (!this.disposed) this.lifecycle.sweepExpired()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const registration of Array.from(this.probeRegistrationsByTabId.values())) {
      this.detachProbeRegistration(registration)
    }
    this.lifecycle.dispose()
  }

  private detachProbeRegistration(registration: ProbeRegistration) {
    registration.adapter.dispose()
    registration.webContents.removeListener('destroyed', registration.destroyedListener)
    if (this.probeRegistrationsByTabId.get(registration.tabId) === registration) {
      this.probeRegistrationsByTabId.delete(registration.tabId)
    }
    if (
      this.probeRegistrationsByWebContentsId.get(registration.webContents.id) === registration
    ) {
      this.probeRegistrationsByWebContentsId.delete(registration.webContents.id)
    }
  }
}
