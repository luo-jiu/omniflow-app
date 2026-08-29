import crypto from 'node:crypto'

import { EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX } from '../../../embeddedBrowserResourceProbeScriptTemplate'
import type { ResourceWriteResult, TabCaptureBinding } from '../state/resource-state-store'
import { createEmbeddedBrowserPageProbeDocumentScript } from './page-probe-document'

type ConsoleMessageListener = (
  event: unknown,
  level: number,
  message: string,
  line: number,
  sourceId: string,
) => void

export type ElectronPageProbeWebContents = {
  readonly id: number
  on(event: 'console-message', listener: ConsoleMessageListener): unknown
  removeListener(event: 'console-message', listener: ConsoleMessageListener): unknown
}

export type ElectronPageProbeLifecycle = {
  bindProbeCapture(input: {
    tabId: string
    webContentsId: number
  }): { capture(payload: unknown): ResourceWriteResult } | null
  resolveBindingByWebContentsId(webContentsId: number): TabCaptureBinding | null
}

export type ElectronPageProbeEventAdapterOptions = {
  createDocumentToken?: () => string
  lifecycle: ElectronPageProbeLifecycle
  onControlPayload?: (payload: Record<string, unknown>) => void
  onError?: (error: unknown) => void
  tabId: string
  webContents: ElectronPageProbeWebContents
}

export type BoundPageProbeDocument = {
  consolePrefix: string
  script: string
}

type ActiveDocumentRoute = BoundPageProbeDocument & {
  capture: NonNullable<ReturnType<ElectronPageProbeLifecycle['bindProbeCapture']>> | null
  incarnation: number
  navigationGeneration: number
}

const supportedControlEvents = new Set(['mse-complete', 'mse-flush', 'mse-reset'])

function normalizeTabId(value: unknown) {
  const tabId = String(value ?? '').trim()
  return tabId || null
}

function normalizeDocumentToken(value: unknown) {
  const token = String(value ?? '').trim()
  return /^[A-Za-z0-9_-]{24,128}$/.test(token) ? token : null
}

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/**
 * Routes one WebContents' probe console transport through a document-scoped
 * token and lifecycle binding. EmbeddedBrowserCaptureRuntime owns the single
 * production registration for each embedded WebContents.
 */
export class ElectronPageProbeEventAdapter {
  private activeRoute: ActiveDocumentRoute | null = null
  private readonly createDocumentToken: () => string
  private disposed = false
  private nextRoute: ActiveDocumentRoute | null = null
  private readonly options: ElectronPageProbeEventAdapterOptions
  private readonly tabId: string

  constructor(options: ElectronPageProbeEventAdapterOptions) {
    const tabId = normalizeTabId(options.tabId)
    if (!tabId) throw new Error('Page probe adapter requires a tab id')
    this.options = options
    this.tabId = tabId
    this.createDocumentToken = options.createDocumentToken
      || (() => crypto.randomBytes(24).toString('base64url'))
    options.webContents.on('console-message', this.handleConsoleMessage)
  }

  bindCurrentDocument(): BoundPageProbeDocument | null {
    if (this.disposed) return null
    const binding = this.resolveCurrentBinding()
    if (!binding) return null
    const capture = this.options.lifecycle.bindProbeCapture({
      tabId: this.tabId,
      webContentsId: this.options.webContents.id,
    })
    if (!capture) return null
    if (this.routeMatchesBinding(this.nextRoute, binding)) {
      this.activeRoute = this.nextRoute
      this.nextRoute = null
    }
    if (this.routeMatchesBinding(this.activeRoute, binding)) {
      this.activeRoute!.capture = capture
      return {
        consolePrefix: this.activeRoute!.consolePrefix,
        script: this.activeRoute!.script,
      }
    }

    const route = this.createRoute({
      capture,
      incarnation: binding.incarnation,
      navigationGeneration: binding.navigationGeneration,
    })
    if (!route) return null
    this.activeRoute = route
    return { consolePrefix: route.consolePrefix, script: route.script }
  }

  prepareNextDocument(): BoundPageProbeDocument | null {
    if (this.disposed) return null
    const binding = this.resolveCurrentBinding()
    if (!binding) return null
    if (!this.options.lifecycle.bindProbeCapture({
      tabId: this.tabId,
      webContentsId: this.options.webContents.id,
    })) {
      return null
    }
    const nextNavigationGeneration = binding.navigationGeneration + 1
    if (
      this.nextRoute
      && this.nextRoute.incarnation === binding.incarnation
      && this.nextRoute.navigationGeneration === nextNavigationGeneration
    ) {
      return {
        consolePrefix: this.nextRoute.consolePrefix,
        script: this.nextRoute.script,
      }
    }
    const route = this.createRoute({
      capture: null,
      incarnation: binding.incarnation,
      navigationGeneration: nextNavigationGeneration,
    })
    if (!route) return null
    this.nextRoute = route
    return { consolePrefix: route.consolePrefix, script: route.script }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.activeRoute = null
    this.nextRoute = null
    this.options.webContents.removeListener('console-message', this.handleConsoleMessage)
  }

  private readonly handleConsoleMessage: ConsoleMessageListener = (
    _event,
    _level,
    message,
  ) => {
    const route = this.resolveMessageRoute(message)
    if (
      this.disposed
      || !route
      || typeof message !== 'string'
      || !this.isRouteCurrent(route)
    ) {
      return
    }
    const payload = parsePayload(message.slice(route.consolePrefix.length))
    if (!payload) return
    try {
      const capture = this.options.lifecycle.bindProbeCapture({
        tabId: this.tabId,
        webContentsId: this.options.webContents.id,
      })
      if (!capture) return
      route.capture = capture
      if (typeof payload.event === 'string') {
        if (supportedControlEvents.has(payload.event)) {
          this.options.onControlPayload?.(payload)
        }
        return
      }
      capture.capture(payload)
    } catch (error) {
      try {
        this.options.onError?.(error)
      } catch {
        // An untrusted page event must not escape into Electron's event loop.
      }
    }
  }

  private resolveCurrentBinding() {
    const binding = this.options.lifecycle.resolveBindingByWebContentsId(
      this.options.webContents.id,
    )
    return binding?.tabId === this.tabId ? binding : null
  }

  private isRouteCurrent(route: ActiveDocumentRoute) {
    const binding = this.resolveCurrentBinding()
    if (!this.routeMatchesBinding(route, binding)) return false
    if (route === this.nextRoute) {
      this.activeRoute = route
      this.nextRoute = null
    }
    return true
  }

  private createRoute(input: Pick<ActiveDocumentRoute, 'capture' | 'incarnation' | 'navigationGeneration'>) {
    const token = normalizeDocumentToken(this.createDocumentToken())
    if (!token) return null
    const consolePrefix = `${EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX}${token}:`
    return {
      ...input,
      consolePrefix,
      script: createEmbeddedBrowserPageProbeDocumentScript({ consolePrefix }),
    }
  }

  private resolveMessageRoute(message: unknown) {
    if (typeof message !== 'string') return null
    if (this.activeRoute && message.startsWith(this.activeRoute.consolePrefix)) {
      return this.activeRoute
    }
    if (this.nextRoute && message.startsWith(this.nextRoute.consolePrefix)) {
      return this.nextRoute
    }
    return null
  }

  private routeMatchesBinding(
    route: ActiveDocumentRoute | null,
    binding: TabCaptureBinding | null,
  ) {
    return Boolean(
      route
      && binding
      && binding.incarnation === route.incarnation
      && binding.navigationGeneration === route.navigationGeneration,
    )
  }
}
