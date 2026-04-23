export type EmbeddedBrowserExternalToolKey = 'aria2' | 'command' | 'protocol'

export type EmbeddedBrowserExternalToolAria2Settings = {
  downloadDir: string
  enabled: boolean
  label: string
  rpcUrl: string
  secret: string
}

export type EmbeddedBrowserExternalToolCommandSettings = {
  enabled: boolean
  label: string
  template: string
  workingDirectory: string
}

export type EmbeddedBrowserExternalToolProtocolSettings = {
  enabled: boolean
  label: string
  urlTemplate: string
}

export type EmbeddedBrowserExternalToolSettings = {
  aria2: EmbeddedBrowserExternalToolAria2Settings
  command: EmbeddedBrowserExternalToolCommandSettings
  protocol: EmbeddedBrowserExternalToolProtocolSettings
}

export type EmbeddedBrowserExternalToolOption = {
  key: EmbeddedBrowserExternalToolKey
  label: string
}

export type EmbeddedBrowserExternalToolDispatchPayload = {
  fileName?: string
  headers?: Record<string, string>
  kind?: string
  mimeType?: string
  pageUrl?: string
  referer?: string
  title?: string
  url: string
}

export function createDefaultEmbeddedBrowserExternalToolSettings(): EmbeddedBrowserExternalToolSettings {
  return {
    aria2: {
      downloadDir: '',
      enabled: false,
      label: 'aria2 RPC',
      rpcUrl: 'http://localhost:6800/jsonrpc',
      secret: '',
    },
    command: {
      enabled: false,
      label: '本地命令',
      template: 'N_m3u8DL-RE "{url}" --save-dir "{downloadDir}" --save-name "{filename}" {headerArgs}',
      workingDirectory: '',
    },
    protocol: {
      enabled: false,
      label: 'm3u8dl URL 协议',
      urlTemplate: 'm3u8dl:{url}',
    },
  }
}

export function cloneEmbeddedBrowserExternalToolSettings(
  settings: EmbeddedBrowserExternalToolSettings,
): EmbeddedBrowserExternalToolSettings {
  return {
    aria2: { ...settings.aria2 },
    command: { ...settings.command },
    protocol: { ...settings.protocol },
  }
}

export function listEnabledEmbeddedBrowserExternalTools(
  settings: EmbeddedBrowserExternalToolSettings,
): EmbeddedBrowserExternalToolOption[] {
  const options: EmbeddedBrowserExternalToolOption[] = []
  if (settings.aria2.enabled) {
    options.push({
      key: 'aria2',
      label: settings.aria2.label || 'aria2 RPC',
    })
  }
  if (settings.command.enabled) {
    options.push({
      key: 'command',
      label: settings.command.label || '本地命令',
    })
  }
  if (settings.protocol.enabled) {
    options.push({
      key: 'protocol',
      label: settings.protocol.label || 'm3u8dl URL 协议',
    })
  }
  return options
}
