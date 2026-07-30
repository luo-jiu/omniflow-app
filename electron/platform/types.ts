import type { BrowserWindowConstructorOptions } from 'electron'

export type MainWindowPlatformOptions = Pick<
  BrowserWindowConstructorOptions,
  | 'titleBarStyle'
  | 'titleBarOverlay'
  | 'trafficLightPosition'
  | 'vibrancy'
  | 'visualEffectState'
>
