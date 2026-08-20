import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { assertMainWindowAIServiceSender } from './aiServiceAccess'

function createFixture() {
  const mainFrame = {} as WebFrameMain
  const mainContents = {
    isDestroyed: vi.fn().mockReturnValue(false),
    mainFrame,
  } as unknown as WebContents
  const mainWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: mainContents,
  } as unknown as BrowserWindow
  return { mainContents, mainFrame, mainWindow }
}

describe('AI service IPC access', () => {
  it('accepts only the main frame of the current main window', () => {
    const fixture = createFixture()
    const event = {
      sender: fixture.mainContents,
      senderFrame: fixture.mainFrame,
    } as IpcMainInvokeEvent

    expect(assertMainWindowAIServiceSender(event, () => fixture.mainWindow))
      .toBe(fixture.mainContents)
  })

  it('rejects another window and a subframe of the main window', () => {
    const fixture = createFixture()
    const otherContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      mainFrame: {} as WebFrameMain,
    } as unknown as WebContents

    expect(() => assertMainWindowAIServiceSender({
      sender: otherContents,
      senderFrame: otherContents.mainFrame,
    } as IpcMainInvokeEvent, () => fixture.mainWindow)).toThrow('无权访问')
    expect(() => assertMainWindowAIServiceSender({
      sender: fixture.mainContents,
      senderFrame: {} as WebFrameMain,
    } as IpcMainInvokeEvent, () => fixture.mainWindow)).toThrow('无权访问')
  })
})
