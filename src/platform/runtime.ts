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
  if (typeof document === 'undefined') return
  document.documentElement.dataset.platform = getDesktopPlatform()
}
