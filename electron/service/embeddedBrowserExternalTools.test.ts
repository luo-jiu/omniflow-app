import { EventEmitter } from 'node:events'
import { rm } from 'node:fs/promises'
import { shell } from 'electron'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, terminateProcessTreeMock, userDataPath } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  terminateProcessTreeMock: vi.fn(),
  userDataPath: `/tmp/omniflow-external-tools-${process.pid}`,
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../platform/processTree', () => ({
  terminateDesktopProcessTree: terminateProcessTreeMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

import {
  dispatchEmbeddedBrowserExternalTool,
  resetEmbeddedBrowserExternalToolSettings,
  updateEmbeddedBrowserExternalToolSettings,
} from './embeddedBrowserExternalTools'
import { defaultProcessingTaskRegistry } from './embedded-browser/processing/task-registry'

function createFakeExternalChild() {
  const child = new EventEmitter() as EventEmitter & {
    unref: () => void
  }
  child.unref = vi.fn()
  return child
}

describe('external tool command lifecycle', () => {
  beforeEach(async () => {
    spawnMock.mockReset()
    terminateProcessTreeMock.mockReset()
    await resetEmbeddedBrowserExternalToolSettings()
  })

  it('keeps launched commands registered until their process exits', async () => {
    const child = createFakeExternalChild()
    spawnMock.mockReturnValue(child)
    await updateEmbeddedBrowserExternalToolSettings({
      aria2: { downloadDir: '', enabled: false, label: 'aria2', rpcUrl: '', secret: '' },
      command: { enabled: true, label: 'command', template: 'tool {url}', workingDirectory: '' },
      protocol: { enabled: false, encodePayload: false, label: 'protocol', urlTemplate: 'm3u8dl:{url}' },
    })

    const dispatch = dispatchEmbeddedBrowserExternalTool('command', {
      url: 'https://media.example/video.m3u8',
    })
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })
    expect(defaultProcessingTaskRegistry.getSnapshot()).toEqual([
      expect.objectContaining({ kind: 'external-command' }),
    ])
    await dispatch
    expect(defaultProcessingTaskRegistry.getSnapshot()).toEqual([
      expect.objectContaining({ kind: 'external-command' }),
    ])
    child.emit('exit', 0, null)
    await vi.waitFor(() => {
      expect(defaultProcessingTaskRegistry.getSnapshot()).toEqual([])
    })
  })

  it('lets app shutdown cancel and await an external command', async () => {
    const child = createFakeExternalChild()
    spawnMock.mockReturnValue(child)
    terminateProcessTreeMock.mockImplementation((_child, options) => {
      if (!options.force) {
        queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
      }
    })
    await updateEmbeddedBrowserExternalToolSettings({
      aria2: { downloadDir: '', enabled: false, label: 'aria2', rpcUrl: '', secret: '' },
      command: { enabled: true, label: 'command', template: 'tool {url}', workingDirectory: '' },
      protocol: { enabled: false, encodePayload: false, label: 'protocol', urlTemplate: 'm3u8dl:{url}' },
    })

    const dispatch = dispatchEmbeddedBrowserExternalTool('command', {
      url: 'https://media.example/video.m3u8',
    })
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })
    const cancelled = defaultProcessingTaskRegistry.cancel({ kind: 'external-command' })
    await expect(dispatch).rejects.toThrow('进程被 SIGTERM 中断')
    await expect(cancelled).resolves.toBe(1)
    expect(terminateProcessTreeMock).toHaveBeenCalledWith(child, expect.objectContaining({
      force: false,
    }))
  })

  it('encodes the complete custom protocol payload as UTF-8 Base64', async () => {
    const openExternalMock = vi.mocked(shell.openExternal)
    openExternalMock.mockReset()
    await updateEmbeddedBrowserExternalToolSettings({
      aria2: { downloadDir: '', enabled: false, label: 'aria2', rpcUrl: '', secret: '' },
      command: { enabled: false, label: 'command', template: 'tool {url}', workingDirectory: '' },
      protocol: {
        enabled: true,
        encodePayload: true,
        label: 'protocol',
        urlTemplate: 'm3u8dl:{url}',
      },
    })

    await dispatchEmbeddedBrowserExternalTool('protocol', {
      title: '示例',
      url: 'https://media.example/视频.m3u8?token=abc',
    })

    const payload = 'https://media.example/视频.m3u8?token=abc'
    expect(openExternalMock).toHaveBeenCalledWith(
      `m3u8dl:${Buffer.from(payload, 'utf8').toString('base64')}`,
    )
  })

  afterAll(async () => {
    await rm(userDataPath, { force: true, recursive: true })
  })
})
