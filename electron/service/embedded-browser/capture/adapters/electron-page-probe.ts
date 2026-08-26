import crypto from 'node:crypto'

import {
  EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
  createEmbeddedBrowserResourceProbeScript,
} from '../../../embeddedBrowserResourceProbe'
import type { ResourceWriteResult, TabCaptureBinding } from '../state/resource-state-store'

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
  capture: NonNullable<ReturnType<ElectronPageProbeLifecycle['bindProbeCapture']>>
  incarnation: number
  navigationGeneration: number
}

const supportedControlEvents = new Set(['mse-flush', 'mse-reset'])

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
 * token and lifecycle binding. Production registration is deferred until the
 * network-capture cutover.
 */
export class ElectronPageProbeEventAdapter {
  private activeRoute: ActiveDocumentRoute | null = null
  private readonly createDocumentToken: () => string
  private disposed = false
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
    if (
      this.activeRoute
      && this.activeRoute.incarnation === binding.incarnation
      && this.activeRoute.navigationGeneration === binding.navigationGeneration
    ) {
      return {
        consolePrefix: this.activeRoute.consolePrefix,
        script: this.activeRoute.script,
      }
    }

    const capture = this.options.lifecycle.bindProbeCapture({
      tabId: this.tabId,
      webContentsId: this.options.webContents.id,
    })
    const token = normalizeDocumentToken(this.createDocumentToken())
    if (!capture || !token) return null
    const consolePrefix = `${EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX}${token}:`
    const script = createEmbeddedBrowserResourceProbeScript({ consolePrefix })
    this.activeRoute = {
      capture,
      consolePrefix,
      incarnation: binding.incarnation,
      navigationGeneration: binding.navigationGeneration,
      script,
    }
    return { consolePrefix, script }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.activeRoute = null
    this.options.webContents.removeListener('console-message', this.handleConsoleMessage)
  }

  private readonly handleConsoleMessage: ConsoleMessageListener = (
    _event,
    _level,
    message,
  ) => {
    const route = this.activeRoute
    if (
      this.disposed
      || !route
      || typeof message !== 'string'
      || !message.startsWith(route.consolePrefix)
      || !this.isRouteCurrent(route)
    ) {
      return
    }
    const payload = parsePayload(message.slice(route.consolePrefix.length))
    if (!payload) return
    try {
      if (typeof payload.event === 'string') {
        if (supportedControlEvents.has(payload.event)) {
          this.options.onControlPayload?.(payload)
        }
        return
      }
      route.capture.capture(payload)
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
    return Boolean(
      binding
      && binding.incarnation === route.incarnation
      && binding.navigationGeneration === route.navigationGeneration,
    )
  }
}
