import type {
  EmbeddedBrowserExternalToolDispatchPayload,
  EmbeddedBrowserExternalToolKey,
  EmbeddedBrowserExternalToolOption,
  EmbeddedBrowserExternalToolSettings,
} from '../model/embedded-browser-external-tools'

const EMBEDDED_BROWSER_EXTERNAL_TOOLS_UPDATED_EVENT = 'embedded-browser:external-tools-updated'

function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持外部工具配置')
  }
}

function emitSettingsUpdated() {
  window.dispatchEvent(new CustomEvent(EMBEDDED_BROWSER_EXTERNAL_TOOLS_UPDATED_EVENT))
}

export async function fetchEmbeddedBrowserExternalToolSettings(): Promise<EmbeddedBrowserExternalToolSettings> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.getExternalToolSettings()
}

export async function updateEmbeddedBrowserExternalToolSettings(
  settings: EmbeddedBrowserExternalToolSettings,
): Promise<EmbeddedBrowserExternalToolSettings> {
  assertDesktopSupport()
  const nextSettings = await window.electronEmbeddedBrowser.updateExternalToolSettings(settings)
  emitSettingsUpdated()
  return nextSettings
}

export async function resetEmbeddedBrowserExternalToolSettings(): Promise<EmbeddedBrowserExternalToolSettings> {
  assertDesktopSupport()
  const nextSettings = await window.electronEmbeddedBrowser.resetExternalToolSettings()
  emitSettingsUpdated()
  return nextSettings
}

export async function listEmbeddedBrowserEnabledExternalTools(): Promise<EmbeddedBrowserExternalToolOption[]> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.listEnabledExternalTools()
}

export async function dispatchEmbeddedBrowserExternalTool(
  toolKey: EmbeddedBrowserExternalToolKey,
  payload: EmbeddedBrowserExternalToolDispatchPayload,
): Promise<void> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.dispatchExternalTool(toolKey, payload)
}

export function subscribeEmbeddedBrowserExternalToolsUpdated(
  listener: () => void,
): () => void {
  const wrapped = () => listener()
  window.addEventListener(EMBEDDED_BROWSER_EXTERNAL_TOOLS_UPDATED_EVENT, wrapped)
  return () => {
    window.removeEventListener(EMBEDDED_BROWSER_EXTERNAL_TOOLS_UPDATED_EVENT, wrapped)
  }
}
