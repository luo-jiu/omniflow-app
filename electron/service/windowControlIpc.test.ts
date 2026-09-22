import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ on: vi.fn(), handle: vi.fn() }))
vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, nativeTheme: {}, ipcMain: mocks }))
import { registerWindowControlIpcHandlers } from './windowControlIpc'

beforeEach(() => vi.clearAllMocks())

describe('Native fullscreen read', () => {
  it('returns actual fullscreen state only to the main window main frame', () => {
    const webContents = { mainFrame: {} }
    const win = { webContents, isDestroyed: () => false, isFullScreen: vi.fn(() => true) }
    registerWindowControlIpcHandlers({ getMainWindow: () => win as never })
    const read = mocks.handle.mock.calls.find(call => call[0] === 'window-get-full-screen')![1]
    expect(read({ sender: {}, senderFrame: webContents.mainFrame })).toBe(false)
    expect(read({ sender: webContents, senderFrame: {} })).toBe(false)
    expect(win.isFullScreen).not.toHaveBeenCalled()
    expect(read({ sender: webContents, senderFrame: webContents.mainFrame })).toBe(true)
    win.isFullScreen.mockReturnValue(false)
    expect(read({ sender: webContents, senderFrame: webContents.mainFrame })).toBe(false)
  })

  it('handles the window being closed', () => {
    registerWindowControlIpcHandlers({ getMainWindow: () => null })
    const read = mocks.handle.mock.calls.find(call => call[0] === 'window-get-full-screen')![1]
    expect(read({ sender: {}, senderFrame: {} })).toBe(false)
  })
})
