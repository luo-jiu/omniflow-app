import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/omniflow-view-lifecycle-test' },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    static getFocusedWindow() { return null }
  },
  dialog: { showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  session: { fromPartition: vi.fn() },
  WebContentsView: class {},
}))

import { installEmbeddedBrowserResourceProbe } from './embeddedBrowserViewLifecycle'

describe('Embedded browser document-start probe installer', () => {
  it('deep.frame-document-start', async () => {
    let documentScriptIndex = 0
    const sendCommand = vi.fn(async (command: string) => {
      if (command === 'Page.addScriptToEvaluateOnNewDocument') {
        documentScriptIndex += 1
        return { identifier: `document-script-${documentScriptIndex}` }
      }
      return {}
    })
    const mainFrameExecute = vi.fn().mockResolvedValue('installed')
    const childFrameExecute = vi.fn().mockResolvedValue('installed')
    const transientFrameExecute = vi.fn().mockRejectedValue(new Error('frame detached'))
    const executeJavaScript = vi.fn().mockResolvedValue('fallback')
    const webContents = {
      debugger: {
        attach: vi.fn(),
        isAttached: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
        sendCommand,
      },
      executeJavaScript,
      getURL: () => 'https://page.example/watch',
      isDestroyed: () => false,
      mainFrame: {
        executeJavaScript: mainFrameExecute,
        framesInSubtree: [
          { executeJavaScript: childFrameExecute },
          { executeJavaScript: transientFrameExecute },
        ],
      },
    }
    const view = { webContents } as unknown as Electron.WebContentsView
    const documents = {
      current: { consolePrefix: 'current:', script: 'current-script' },
      next: { consolePrefix: 'next:', script: 'next-script' },
    }

    await expect(installEmbeddedBrowserResourceProbe('tab-document', view, documents))
      .resolves.toBe(true)
    expect(webContents.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(sendCommand.mock.calls.slice(0, 2)).toEqual([
      ['Page.enable'],
      ['Page.addScriptToEvaluateOnNewDocument', { source: 'next-script' }],
    ])
    expect(mainFrameExecute).toHaveBeenCalledWith('current-script', true)
    expect(childFrameExecute).toHaveBeenCalledWith('current-script', true)
    expect(transientFrameExecute).toHaveBeenCalledWith('current-script', true)
    expect(executeJavaScript).not.toHaveBeenCalled()

    await expect(installEmbeddedBrowserResourceProbe('tab-document', view, documents))
      .resolves.toBe(true)
    expect(sendCommand.mock.calls.slice(2)).toEqual([
      ['Page.removeScriptToEvaluateOnNewDocument', { identifier: 'document-script-1' }],
      ['Page.enable'],
      ['Page.addScriptToEvaluateOnNewDocument', { source: 'next-script' }],
    ])
  })
})
