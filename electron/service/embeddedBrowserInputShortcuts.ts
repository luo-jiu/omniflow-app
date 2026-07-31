import {
  Menu,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron'

export type EmbeddedBrowserInputShortcutAction =
  | 'devtools'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'

const CHROMIUM_ZOOM_FACTORS = [
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
  4,
  5,
] as const

const ZOOM_FACTOR_EPSILON = 0.001

function isKeyDown(input: Electron.Input) {
  return input.type === 'keyDown'
}

function isPrimaryModifierPressed(
  input: Electron.Input,
  platform: NodeJS.Platform,
) {
  return platform === 'darwin' ? input.meta : input.control
}

export function isDevToolsToggleShortcut(
  input: Electron.Input,
  platform: NodeJS.Platform = process.platform,
) {
  if (!isKeyDown(input)) {
    return false
  }

  const key = (input.key || '').toLowerCase()
  const code = input.code || ''
  if (key === 'f12' || code === 'F12') {
    return true
  }
  if (key !== 'i' && code !== 'KeyI') {
    return false
  }
  if (platform === 'darwin') {
    return Boolean(input.meta && (input.alt || input.shift))
  }
  return Boolean(input.control && input.shift)
}

function getZoomShortcutAction(
  input: Electron.Input,
  platform: NodeJS.Platform,
): EmbeddedBrowserInputShortcutAction | null {
  if (!isKeyDown(input) || !isPrimaryModifierPressed(input, platform)) {
    return null
  }

  const key = (input.key || '').toLowerCase()
  const code = input.code || ''
  if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd') {
    return 'zoom-in'
  }
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') {
    return 'zoom-out'
  }
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
    return 'zoom-reset'
  }
  return null
}

export function getEmbeddedBrowserInputShortcutAction(
  input: Electron.Input,
  platform: NodeJS.Platform = process.platform,
): EmbeddedBrowserInputShortcutAction | null {
  if (isDevToolsToggleShortcut(input, platform)) {
    return 'devtools'
  }
  return getZoomShortcutAction(input, platform)
}

function getNextZoomFactor(currentFactor: number, direction: 'in' | 'out') {
  if (direction === 'in') {
    return CHROMIUM_ZOOM_FACTORS.find((factor) => (
      factor > currentFactor + ZOOM_FACTOR_EPSILON
    )) ?? CHROMIUM_ZOOM_FACTORS[CHROMIUM_ZOOM_FACTORS.length - 1]
  }

  return [...CHROMIUM_ZOOM_FACTORS].reverse().find((factor) => (
    factor < currentFactor - ZOOM_FACTOR_EPSILON
  )) ?? CHROMIUM_ZOOM_FACTORS[0]
}

export function toggleEmbeddedBrowserDevTools(webContents: WebContents) {
  if (webContents.isDestroyed()) {
    return
  }
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
    return
  }
  if (webContents.debugger.isAttached()) {
    try {
      webContents.debugger.detach()
    } catch {
      // DevTools will report its own open failure if the debugger cannot be replaced.
    }
  }
  webContents.openDevTools({ activate: true, mode: 'right' })
}

function applyZoomShortcut(
  webContents: WebContents,
  action: Exclude<EmbeddedBrowserInputShortcutAction, 'devtools'>,
) {
  if (action === 'zoom-reset') {
    webContents.setZoomFactor(1)
    return
  }
  const direction = action === 'zoom-in' ? 'in' : 'out'
  webContents.setZoomFactor(getNextZoomFactor(webContents.getZoomFactor(), direction))
}

export function handleEmbeddedBrowserInputShortcut(
  webContents: WebContents,
  input: Electron.Input,
  platform: NodeJS.Platform = process.platform,
) {
  if (webContents.isDestroyed()) {
    return false
  }
  const action = getEmbeddedBrowserInputShortcutAction(input, platform)
  if (!action) {
    return false
  }
  if (action === 'devtools') {
    toggleEmbeddedBrowserDevTools(webContents)
  } else {
    applyZoomShortcut(webContents, action)
  }
  return true
}

function inspectEmbeddedBrowserElement(
  webContents: WebContents,
  x: number,
  y: number,
) {
  if (webContents.isDevToolsOpened()) {
    webContents.inspectElement(x, y)
    return
  }
  if (webContents.debugger.isAttached()) {
    try {
      webContents.debugger.detach()
    } catch {
      // DevTools will report its own open failure if the debugger cannot be replaced.
    }
  }
  webContents.once('devtools-opened', () => {
    if (!webContents.isDestroyed()) {
      webContents.inspectElement(x, y)
    }
  })
  webContents.openDevTools({ activate: true, mode: 'right' })
}

export function showEmbeddedBrowserContextMenu(
  webContents: WebContents,
  params: ContextMenuParams,
) {
  if (webContents.isDestroyed()) {
    return
  }

  const template: MenuItemConstructorOptions[] = []
  if (params.isEditable) {
    template.push(
      { enabled: params.editFlags.canUndo, role: 'undo' },
      { enabled: params.editFlags.canRedo, role: 'redo' },
      { type: 'separator' },
      { enabled: params.editFlags.canCut, role: 'cut' },
      { enabled: params.editFlags.canCopy, role: 'copy' },
      { enabled: params.editFlags.canPaste, role: 'paste' },
      { enabled: params.editFlags.canDelete, role: 'delete' },
      { type: 'separator' },
      { enabled: params.editFlags.canSelectAll, role: 'selectAll' },
      { type: 'separator' },
    )
  } else if (params.editFlags.canCopy) {
    template.push(
      { role: 'copy' },
      { type: 'separator' },
    )
  }

  template.push({
    click: () => inspectEmbeddedBrowserElement(webContents, params.x, params.y),
    label: '检查',
  })
  Menu.buildFromTemplate(template).popup()
}
