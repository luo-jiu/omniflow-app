import { describe, expect, it, vi } from 'vitest'

import { LIBRARY_FILE_BROWSER_DRAG_DATA_TYPE } from '../../src/features/file-transfer/model/file-transfer'
import {
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX,
  createEmbeddedBrowserLibraryFileDropScript,
} from './embeddedBrowserLibraryFileDropScript'

function installScript(options: { insideUnsupportedFrame?: boolean } = {}) {
  const listeners = new Map<string, (event: unknown) => void>()
  const document = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener)
    },
  }
  const topWindow: Record<string, any> = {}
  topWindow.top = topWindow
  const window: Record<string, any> = options.insideUnsupportedFrame
    ? { frameElement: null, parent: topWindow, top: topWindow }
    : topWindow
  const info = vi.fn()
  const script = createEmbeddedBrowserLibraryFileDropScript('view-secret')
  new Function('window', 'document', 'console', 'location', script)(
    window,
    document,
    { info },
    { href: 'https://example.com/upload' },
  )
  return { info, listeners }
}

function createDropEvent(isTrusted: boolean) {
  return {
    clientX: 30,
    clientY: 40,
    dataTransfer: {
      getData: () => JSON.stringify({
        claimId: '12345678-1234-1234-1234-123456789abc',
        fileName: 'song.mp3',
        mimeType: 'audio/mpeg',
      }),
      types: [LIBRARY_FILE_BROWSER_DRAG_DATA_TYPE],
    },
    isTrusted,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  }
}

describe('embeddedBrowserLibraryFileDropScript', () => {
  it('reports a trusted top-level drop with the isolated-world nonce', () => {
    const { info, listeners } = installScript()
    listeners.get('drop')?.(createDropEvent(true))

    const message = String(info.mock.calls[0]?.[0] || '')
    expect(message.startsWith(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX)).toBe(true)
    expect(JSON.parse(message.slice(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX.length))).toMatchObject({
      clientX: 30,
      clientY: 40,
      frameCoordinateSupported: true,
      nonce: 'view-secret',
    })
  })

  it('ignores synthetic page events', () => {
    const { info, listeners } = installScript()
    listeners.get('drop')?.(createDropEvent(false))
    expect(info).not.toHaveBeenCalled()
  })

  it('marks iframe coordinates unsupported when the frame cannot be resolved', () => {
    const { info, listeners } = installScript({ insideUnsupportedFrame: true })
    listeners.get('drop')?.(createDropEvent(true))

    const message = String(info.mock.calls[0]?.[0] || '')
    expect(JSON.parse(message.slice(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX.length))).toMatchObject({
      frameCoordinateSupported: false,
    })
  })
})
