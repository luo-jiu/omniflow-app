import type { ResourceStateChange } from '../contracts/captured-resource'
import type { NetworkContextVault } from '../capture/state/network-context-vault'
import {
  type CaptureMode,
  type ResourceStateStore,
  type TabCaptureBinding,
} from '../capture/state/resource-state-store'

type DidNavigateListener = (event: unknown, url: string) => void
type RenderProcessGoneListener = (
  event: unknown,
  details: { reason?: string },
) => void
type DestroyedListener = () => void

export type EmbeddedBrowserLifecycleWebContents = {
  readonly id: number
  getURL?(): string
  on(event: 'did-navigate', listener: DidNavigateListener): unknown
  on(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  once(event: 'destroyed', listener: DestroyedListener): unknown
  removeListener(event: 'did-navigate', listener: DidNavigateListener): unknown
  removeListener(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  removeListener(event: 'destroyed', listener: DestroyedListener): unknown
}

export type EmbeddedBrowserLifecycleNetworkAdapter = {
  dispose(): void
  sweepExpired?(): void
}

export type EmbeddedBrowserLifecycleOptions = {
  emitChange: (change: ResourceStateChange) => void
  store: ResourceStateStore
  vault: NetworkContextVault
}

export type RegisterEmbeddedBrowserViewInput = {
  clearResourcesOnNavigation?: boolean
  pageUrl?: string
  tabId: string
  webContents: EmbeddedBrowserLifecycleWebContents
}

export type CommitEmbeddedBrowserNavigationInput = {
  clearResources?: boolean
  pageUrl: string
  tabId: string
  webContentsId: number
}

type ViewRegistration = {
  binding: TabCaptureBinding
  clearResourcesOnNavigation: boolean
  crashed: boolean
  destroyedListener: DestroyedListener
  didNavigateListener: DidNavigateListener
  pageUrl: string
  renderProcessGoneListener: RenderProcessGoneListener
  tabId: string
  webContents: EmbeddedBrowserLifecycleWebContents
}

function normalizeTabId(value: unknown) {
  const tabId = String(value ?? '').trim()
  return tabId || null
}

function normalizeWebContentsId(value: unknown) {
  const webContentsId = Number(value)
  return Number.isInteger(webContentsId) && webContentsId > 0 ? webContentsId : null
}

function normalizePageUrl(value: unknown) {
  return String(value ?? '').trim()
}

/**
 * Owns the capture state lifetime for a tab/WebContents pair. Production wiring is
 * intentionally deferred until the complete network-capture cutover is ready.
 */
export class EmbeddedBrowserLifecycle {
  private disposed = false
  private readonly options: EmbeddedBrowserLifecycleOptions
  private networkAdapter: EmbeddedBrowserLifecycleNetworkAdapter | null = null
  private readonly registrationsByTabId = new Map<string, ViewRegistration>()
  private readonly registrationsByWebContentsId = new Map<number, ViewRegistration>()

  constructor(options: EmbeddedBrowserLifecycleOptions) {
    this.options = options
  }

  attachNetworkAdapter(adapter: EmbeddedBrowserLifecycleNetworkAdapter) {
    if (this.disposed) {
      adapter.dispose()
      return false
    }
    if (this.networkAdapter && this.networkAdapter !== adapter) {
      throw new Error('Embedded browser lifecycle already owns a network adapter')
    }
    this.networkAdapter = adapter
    return true
  }

  registerView(input: RegisterEmbeddedBrowserViewInput): TabCaptureBinding | null {
    if (this.disposed) return null
    const tabId = normalizeTabId(input.tabId)
    const webContentsId = normalizeWebContentsId(input.webContents?.id)
    if (!tabId || webContentsId === null) return null

    const pageUrl = normalizePageUrl(input.pageUrl || input.webContents.getURL?.())
    const existingForTab = this.registrationsByTabId.get(tabId)
    if (existingForTab?.webContents.id === webContentsId) {
      existingForTab.clearResourcesOnNavigation = input.clearResourcesOnNavigation !== false
      if (pageUrl) existingForTab.pageUrl = pageUrl
      return { ...existingForTab.binding }
    }

    const existingForWebContents = this.registrationsByWebContentsId.get(webContentsId)
    if (existingForWebContents && existingForWebContents.tabId !== tabId) {
      this.closeTab(existingForWebContents.tabId)
    }

    const previousWebContentsId = existingForTab?.webContents.id
    if (existingForTab) this.detachRegistration(existingForTab)

    const registered = this.options.store.registerTab({
      pageUrl: pageUrl || undefined,
      tabId,
      webContentsId,
    })
    if (!registered) return null
    if (registered.change) this.options.emitChange(registered.change)
    if (previousWebContentsId && previousWebContentsId !== webContentsId) {
      this.options.vault.clearWebContents(previousWebContentsId)
    }

    const registration = this.createRegistration({
      binding: registered.binding,
      clearResourcesOnNavigation: input.clearResourcesOnNavigation !== false,
      pageUrl,
      tabId,
      webContents: input.webContents,
    })
    this.registrationsByTabId.set(tabId, registration)
    this.registrationsByWebContentsId.set(webContentsId, registration)
    this.attachRegistration(registration)
    return { ...registration.binding }
  }

  resolveBindingByWebContentsId(webContentsId: number) {
    if (this.disposed) return null
    const normalizedWebContentsId = normalizeWebContentsId(webContentsId)
    const registration = normalizedWebContentsId === null
      ? null
      : this.registrationsByWebContentsId.get(normalizedWebContentsId)
    if (!registration || registration.crashed || !this.isCurrent(registration)) return null
    const binding = this.options.store.getCaptureBinding(registration.tabId)
    if (!binding || binding.webContentsId !== normalizedWebContentsId) return null
    registration.binding = binding
    return { ...binding }
  }

  resolvePageUrlByWebContentsId(webContentsId: number) {
    if (this.disposed) return null
    const normalizedWebContentsId = normalizeWebContentsId(webContentsId)
    const registration = normalizedWebContentsId === null
      ? null
      : this.registrationsByWebContentsId.get(normalizedWebContentsId)
    if (!registration || registration.crashed || !this.isCurrent(registration)) return null
    return registration.pageUrl || null
  }

  setCaptureMode(tabId: string, captureMode: CaptureMode) {
    if (this.disposed) return null
    const change = this.options.store.setCaptureMode(tabId, captureMode)
    if (change) this.options.emitChange(change)
    return change
  }

  clearResources(tabId: string) {
    if (this.disposed) return null
    const normalizedTabId = normalizeTabId(tabId)
    if (!normalizedTabId) return null
    const change = this.options.store.clearResources(normalizedTabId)
    if (change) this.options.emitChange(change)
    this.options.vault.clearTab(normalizedTabId)
    return change
  }

  commitNavigation(input: CommitEmbeddedBrowserNavigationInput) {
    if (this.disposed) return null
    const tabId = normalizeTabId(input.tabId)
    const webContentsId = normalizeWebContentsId(input.webContentsId)
    const pageUrl = normalizePageUrl(input.pageUrl)
    if (!tabId || webContentsId === null || !pageUrl) return null
    const registration = this.registrationsByTabId.get(tabId)
    if (
      !registration
      || registration.webContents.id !== webContentsId
      || !this.isCurrent(registration)
    ) {
      return null
    }
    return this.commitOwnedNavigation(
      registration,
      pageUrl,
      input.clearResources !== false,
      false,
    )
  }

  closeTab(tabId: string) {
    if (this.disposed) return false
    const normalizedTabId = normalizeTabId(tabId)
    if (!normalizedTabId) return false
    const registration = this.registrationsByTabId.get(normalizedTabId)
    if (registration) this.detachRegistration(registration)
    const change = this.options.store.disposeTab(normalizedTabId)
    if (change) this.options.emitChange(change)
    this.options.vault.clearTab(normalizedTabId)
    return Boolean(registration || change)
  }

  disposeWebContents(webContentsId: number) {
    if (this.disposed) return false
    const normalizedWebContentsId = normalizeWebContentsId(webContentsId)
    if (normalizedWebContentsId === null) return false
    const registration = this.registrationsByWebContentsId.get(normalizedWebContentsId)
    if (registration) this.detachRegistration(registration)
    const changes = this.options.store.disposeWebContents(normalizedWebContentsId)
    for (const change of changes) this.options.emitChange(change)
    this.options.vault.clearWebContents(normalizedWebContentsId)
    return Boolean(registration || changes.length)
  }

  closeAll() {
    if (this.disposed) return 0
    const tabIds = Array.from(this.registrationsByTabId.keys())
    let closed = 0
    for (const tabId of tabIds) {
      if (this.closeTab(tabId)) closed += 1
    }
    for (const change of this.options.store.disposeAll()) {
      this.options.emitChange(change)
      closed += 1
    }
    this.options.vault.clear()
    return closed
  }

  sweepExpired() {
    if (this.disposed) return
    if (this.networkAdapter?.sweepExpired) {
      this.networkAdapter.sweepExpired()
      return
    }
    this.options.vault.sweepExpired()
    for (const change of this.options.store.sweepExpired()) this.options.emitChange(change)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true

    // Stop the event source before destroying its state owners.
    this.networkAdapter?.dispose()
    this.networkAdapter = null
    for (const registration of Array.from(this.registrationsByTabId.values())) {
      this.detachRegistration(registration)
    }
    for (const change of this.options.store.disposeAll()) this.options.emitChange(change)
    this.options.vault.clear()
  }

  private createRegistration(input: {
    binding: TabCaptureBinding
    clearResourcesOnNavigation: boolean
    pageUrl: string
    tabId: string
    webContents: EmbeddedBrowserLifecycleWebContents
  }): ViewRegistration {
    const registration = {
      ...input,
      crashed: false,
    } as ViewRegistration
    registration.didNavigateListener = (_event, url) => {
      if (!this.isCurrent(registration)) return
      const pageUrl = normalizePageUrl(url)
      if (!pageUrl) return
      this.commitOwnedNavigation(
        registration,
        pageUrl,
        registration.clearResourcesOnNavigation,
        false,
      )
    }
    registration.renderProcessGoneListener = () => {
      if (!this.isCurrent(registration) || registration.crashed) return
      const pageUrl = registration.pageUrl
        || normalizePageUrl(registration.webContents.getURL?.())
        || 'about:blank'
      this.commitOwnedNavigation(registration, pageUrl, true, true)
    }
    registration.destroyedListener = () => {
      if (!this.isCurrent(registration)) return
      this.disposeWebContents(registration.webContents.id)
    }
    return registration
  }

  private attachRegistration(registration: ViewRegistration) {
    registration.webContents.on('did-navigate', registration.didNavigateListener)
    registration.webContents.on(
      'render-process-gone',
      registration.renderProcessGoneListener,
    )
    registration.webContents.once('destroyed', registration.destroyedListener)
  }

  private detachRegistration(registration: ViewRegistration) {
    registration.webContents.removeListener('did-navigate', registration.didNavigateListener)
    registration.webContents.removeListener(
      'render-process-gone',
      registration.renderProcessGoneListener,
    )
    registration.webContents.removeListener('destroyed', registration.destroyedListener)
    if (this.registrationsByTabId.get(registration.tabId) === registration) {
      this.registrationsByTabId.delete(registration.tabId)
    }
    if (
      this.registrationsByWebContentsId.get(registration.webContents.id) === registration
    ) {
      this.registrationsByWebContentsId.delete(registration.webContents.id)
    }
  }

  private isCurrent(registration: ViewRegistration) {
    return !this.disposed
      && this.registrationsByTabId.get(registration.tabId) === registration
      && this.registrationsByWebContentsId.get(registration.webContents.id) === registration
  }

  private commitOwnedNavigation(
    registration: ViewRegistration,
    pageUrl: string,
    clearResources: boolean,
    crashed: boolean,
  ) {
    const binding = this.options.store.getCaptureBinding(registration.tabId)
    if (
      !binding
      || binding.incarnation !== registration.binding.incarnation
      || binding.webContentsId !== registration.webContents.id
    ) {
      return null
    }
    const result = this.options.store.commitNavigation({
      binding,
      clearResources,
      pageUrl,
    })
    if (!result) return null
    registration.binding = result.binding
    registration.crashed = crashed
    registration.pageUrl = pageUrl
    if (result.change) this.options.emitChange(result.change)
    this.options.vault.clearWebContents(registration.webContents.id)
    return {
      binding: { ...result.binding },
      change: result.change,
    }
  }
}
