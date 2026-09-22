import type { DesktopHostPlatform, DesktopPlatform } from './types'

function normalizeHostPlatform(platform: DesktopHostPlatform | undefined): DesktopPlatform {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return 'unknown'
}

function detectBrowserPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('windows')) return 'windows'
  if (userAgent.includes('macintosh') || userAgent.includes('mac os')) return 'macos'
  if (userAgent.includes('linux')) return 'linux'
  return 'unknown'
}

export function getDesktopPlatform(): DesktopPlatform {
  if (typeof window === 'undefined') return 'unknown'
  const hostPlatform = normalizeHostPlatform(window.electronWindow?.platform)
  return hostPlatform === 'unknown' ? detectBrowserPlatform() : hostPlatform
}

export function installDesktopPlatformDomState() {
  if (typeof document === 'undefined') return () => undefined
  document.documentElement.dataset.platform = getDesktopPlatform()
  const root = document.documentElement
  root.dataset.windowFullscreen = 'false'
  let disposed = false
  let receivedEvent = false
  const bridge = typeof window === 'undefined' ? undefined : window.electronWindow
  const unsubscribe = bridge?.onFullScreenChange?.(fullScreen => {
    if (disposed) return
    receivedEvent = true
    root.dataset.windowFullscreen = String(fullScreen === true)
  })
  // A transition received during the initial read is newer than its reply.
  void bridge?.getFullScreen?.().then(fullScreen => {
    if (!disposed && !receivedEvent) root.dataset.windowFullscreen = String(fullScreen === true)
  }).catch(() => undefined)
  return () => {
    disposed = true
    unsubscribe?.()
  }
}
